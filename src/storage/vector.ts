import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { loadConfig, type Config } from "../config";
import type { Memory, MemoryLayer, MemorySearchResult } from "../types";
import { rowToMemory, type SqlMemoryRow } from "./serialize";

interface EmbeddingRow {
  memory_id: string;
  vector: string | null;
  vector_blob: Uint8Array | null;
  model: string;
  updated_at: string;
  dimensions: number;
  norm: number;
}

interface EmbeddingSearchRow extends SqlMemoryRow, EmbeddingRow {}

interface CountRow {
  count: number;
}

interface EmbeddingStatsRow {
  indexed: number;
  lastIndexedAt: string | null;
}

interface LanceVectorRow extends Record<string, unknown> {
  id: string;
  vector: number[];
  layer: MemoryLayer;
  project: string;
  salience: number;
  createdAt: string;
  updatedAt: string;
  status: Memory["status"];
  title: string;
  summary: string;
  details: string;
  tags: string;
  sourceSessionId: string;
  sourceAgent: Memory["sourceAgent"];
  sourceSessionIds: string;
  supportingMemoryIds: string;
  linkedMemoryIds: string;
  contradicts: string;
  _distance?: number;
}

const MIN_LANCE_PQ_TRAINING_ROWS = 256;

export interface VectorStoreSearchOptions {
  excludeIds?: string[];
  layers?: MemoryLayer[];
  project?: string;
  candidateIds?: string[];
}

export interface VectorIndexSummary {
  name: string;
  type: string;
  columns: string[];
  indexedRows?: number;
  unindexedRows?: number;
  distanceType?: string;
}

export interface VectorStoreStatus {
  backend: Config["vectorBackend"];
  indexed: number;
  lastIndexedAt: string | null;
  indices: VectorIndexSummary[];
  totalRows?: number;
  totalBytes?: number;
}

export interface VectorOptimizeResult {
  backend: Config["vectorBackend"];
  optimized: boolean;
  details: string[];
}

export interface VectorStore {
  backend(): Config["vectorBackend"];
  init(): Promise<void>;
  reset(): Promise<void>;
  upsert(memory: Memory, vector: number[], model: string): Promise<void>;
  get(memoryId: string): Promise<{ model: string; vector: number[] } | null>;
  stats(): Promise<{ indexed: number; lastIndexedAt: string | null }>;
  status(): Promise<VectorStoreStatus>;
  optimize(): Promise<VectorOptimizeResult>;
  listCandidateIds(limit: number, options?: Omit<VectorStoreSearchOptions, "candidateIds">): Promise<string[]>;
  search(queryVector: number[], limit?: number, options?: VectorStoreSearchOptions): Promise<MemorySearchResult[]>;
  close(): void;
}

export interface VectorStoreOptions {
  backend?: Config["vectorBackend"];
  dbPath?: string;
  lanceDir?: string;
  config?: Config;
}

export function createVectorStore(options: VectorStoreOptions = {}): VectorStore {
  const config = options.config ?? loadConfig();
  const backend = options.backend ?? config.vectorBackend;

  if (backend === "sqlite") {
    return new SqliteVectorStore(options.dbPath ?? config.sqlitePath);
  }

  if (backend === "lancedb") {
    return new LanceDbVectorStore(options.lanceDir ?? config.lanceDir);
  }

  throw new Error(`Unsupported vector backend: ${backend satisfies never}`);
}

class SqliteVectorStore implements VectorStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  backend() {
    return "sqlite" as const;
  }

  async init() {}

  async reset() {
    this.db.exec("DELETE FROM memory_embeddings");
  }

  async upsert(memory: Memory, vector: number[], model: string) {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings
      (memory_id, vector, vector_blob, model, updated_at, dimensions, norm)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      JSON.stringify(vector),
      encodeVector(vector),
      model,
      new Date().toISOString(),
      vector.length,
      vectorNorm(vector),
    );
  }

  async get(memoryId: string) {
    const row = this.db.prepare(
      "SELECT memory_id, vector, vector_blob, model, updated_at, dimensions, norm FROM memory_embeddings WHERE memory_id = ?",
    ).get(memoryId) as EmbeddingRow | null;

    if (!row) {
      return null;
    }

    return {
      model: row.model,
      vector: decodeEmbeddingVector(row),
    };
  }

  async stats() {
    const row = this.db.prepare(
      "SELECT COUNT(*) as indexed, MAX(updated_at) as lastIndexedAt FROM memory_embeddings",
    ).get() as EmbeddingStatsRow | null;

    return {
      indexed: row?.indexed ?? 0,
      lastIndexedAt: row?.lastIndexedAt ?? null,
    };
  }

  async status(): Promise<VectorStoreStatus> {
    const stats = await this.stats();
    return {
      backend: this.backend(),
      indexed: stats.indexed,
      lastIndexedAt: stats.lastIndexedAt,
      indices: [],
    };
  }

  async optimize(): Promise<VectorOptimizeResult> {
    return {
      backend: this.backend(),
      optimized: false,
      details: ["sqlite vector backend has no ANN index maintenance step"],
    };
  }

  async listCandidateIds(limit: number, options: Omit<VectorStoreSearchOptions, "candidateIds"> = {}) {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.layers?.length) {
      clauses.push(`layer IN (${options.layers.map(() => "?").join(", ")})`);
      params.push(...options.layers);
    }

    if (options.project) {
      clauses.push("project = ?");
      params.push(options.project);
    }

    if (options.excludeIds?.length) {
      clauses.push(`id NOT IN (${options.excludeIds.map(() => "?").join(", ")})`);
      params.push(...options.excludeIds);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT id
      FROM memories
      ${whereClause}
      ORDER BY salience DESC, created_at DESC
      LIMIT ?
    `).all(...params, limit) as Array<{ id: string }>;

    return rows.map((row) => row.id);
  }

  async search(queryVector: number[], limit = 10, options: VectorStoreSearchOptions = {}) {
    if (options.candidateIds && options.candidateIds.length === 0) {
      return [];
    }

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.layers?.length) {
      clauses.push(`m.layer IN (${options.layers.map(() => "?").join(", ")})`);
      params.push(...options.layers);
    }

    if (options.project) {
      clauses.push("m.project = ?");
      params.push(options.project);
    }

    if (options.excludeIds?.length) {
      clauses.push(`m.id NOT IN (${options.excludeIds.map(() => "?").join(", ")})`);
      params.push(...options.excludeIds);
    }

    if (options.candidateIds?.length) {
      clauses.push(`m.id IN (${options.candidateIds.map(() => "?").join(", ")})`);
      params.push(...options.candidateIds);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT
        m.*,
        e.memory_id,
        e.vector,
        e.vector_blob,
        e.model,
        e.updated_at,
        e.dimensions,
        e.norm
      FROM memories m
      JOIN memory_embeddings e ON e.memory_id = m.id
      ${whereClause}
      ORDER BY m.salience DESC, m.created_at DESC
    `).all(...params) as EmbeddingSearchRow[];

    const queryNorm = vectorNorm(queryVector);

    return rows
      .map((row) => ({
        memory: rowToMemory(row),
        score: cosineSimilarity(queryVector, decodeEmbeddingVector(row), queryNorm, row.norm),
        reasons: ["embedding"],
      }))
      .filter((hit) => Number.isFinite(hit.score) && hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model);
    `);

    this.ensureColumn("vector_blob", "BLOB");
    this.ensureColumn("norm", "REAL NOT NULL DEFAULT 0");
  }

  private ensureColumn(column: string, definition: string) {
    const columns = this.db
      .prepare("PRAGMA table_info(memory_embeddings)")
      .all() as Array<{ name: string }>;

    if (columns.some((existing) => existing.name === column)) {
      return;
    }

    this.db.exec(`ALTER TABLE memory_embeddings ADD COLUMN ${column} ${definition}`);
  }
}

class LanceDbVectorStore implements VectorStore {
  private connection: Connection | null = null;
  private table: Table | null = null;
  private initPromise: Promise<void> | null = null;
  private indicesEnsured = false;

  constructor(private lanceDir: string) {}

  backend() {
    return "lancedb" as const;
  }

  async init() {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  async reset() {
    await this.init();
    if (!this.connection) {
      return;
    }

    try {
      await this.connection.dropTable("memory_vectors");
    } catch {}

    this.table?.close();
    this.table = null;
    this.indicesEnsured = false;
  }

  async upsert(memory: Memory, vector: number[], _model: string) {
    await this.init();
    let table = this.table;
    if (!table) {
      table = await this.connection!.createTable("memory_vectors", [serializeLanceRow(memory, vector)]);
      this.table = table;
      this.indicesEnsured = false;
      await this.ensureIndices(table);
      return;
    }

    await table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([serializeLanceRow(memory, vector)]);
    await this.ensureIndices(table);
  }

  async get(memoryId: string) {
    await this.init();
    if (!this.table) {
      return null;
    }
    const rows = await this.table!
      .query()
      .where(`id = ${sqlString(memoryId)}`)
      .select(["vector"])
      .limit(1)
      .toArray();

    const row = rows[0] as { vector?: number[] } | undefined;
    if (!row?.vector) {
      return null;
    }

    return {
      model: "lancedb",
      vector: row.vector,
    };
  }

  async stats() {
    await this.init();
    if (!this.table) {
      return { indexed: 0, lastIndexedAt: null };
    }

    const indexed = await this.table.countRows();
    const rows = await this.table.query().select(["createdAt"]).toArray();
    const lastIndexedAt = rows.reduce<string | null>((latest, row) => {
      const current = typeof (row as { createdAt?: string }).createdAt === "string"
        ? (row as { createdAt: string }).createdAt
        : null;
      if (!current) {
        return latest;
      }
      return !latest || current > latest ? current : latest;
    }, null);

    return {
      indexed,
      lastIndexedAt,
    };
  }

  async status(): Promise<VectorStoreStatus> {
    await this.init();
    if (!this.table) {
      return {
        backend: this.backend(),
        indexed: 0,
        lastIndexedAt: null,
        indices: [],
      };
    }

    const [stats, tableStats, indices] = await Promise.all([
      this.stats(),
      this.table.stats(),
      this.table.listIndices(),
    ]);

    const indexSummaries = await Promise.all(
      indices.map(async (index) => {
        const details = await this.table!.indexStats(index.name).catch(() => undefined);
        return {
          name: index.name,
          type: index.indexType,
          columns: index.columns,
          indexedRows: details?.numIndexedRows,
          unindexedRows: details?.numUnindexedRows,
          distanceType: details?.distanceType,
        } satisfies VectorIndexSummary;
      }),
    );

    return {
      backend: this.backend(),
      indexed: stats.indexed,
      lastIndexedAt: stats.lastIndexedAt,
      indices: indexSummaries,
      totalRows: tableStats.numRows,
      totalBytes: tableStats.totalBytes,
    };
  }

  async optimize(): Promise<VectorOptimizeResult> {
    await this.init();
    if (!this.table) {
      return {
        backend: this.backend(),
        optimized: false,
        details: ["no LanceDB table exists yet"],
      };
    }

    const before = await this.table.listIndices();
    await this.ensureIndices(this.table);
    const optimizeStats = await this.table.optimize();
    const after = await this.table.listIndices();

    return {
      backend: this.backend(),
      optimized: true,
      details: [
        `indices=${after.map((index) => index.name).join(",") || "(none)"}`,
        `compactedFragments=${optimizeStats.compaction.fragmentsRemoved}`,
        `filesAdded=${optimizeStats.compaction.filesAdded}`,
        `filesRemoved=${optimizeStats.compaction.filesRemoved}`,
        `prunedVersions=${optimizeStats.prune.oldVersionsRemoved}`,
        before.length === after.length ? "indexSet=unchanged" : "indexSet=updated",
      ],
    };
  }

  async listCandidateIds(limit: number, options: Omit<VectorStoreSearchOptions, "candidateIds"> = {}) {
    await this.init();
    if (!this.table) {
      return [];
    }
    let query = this.table!
      .query()
      .select(["id"])
      .limit(limit);

    const predicate = buildLancePredicate(options);
    if (predicate) {
      query = query.where(predicate);
    }

    const rows = await query.toArray();
    return rows.map((row) => String((row as { id: string }).id));
  }

  async search(queryVector: number[], limit = 10, options: VectorStoreSearchOptions = {}) {
    await this.init();
    if (!this.table) {
      return [];
    }
    let query = this.table!
      .vectorSearch(queryVector)
      .distanceType("cosine")
      .limit(limit)
      .refineFactor(2);

    const predicate = buildLancePredicate(options);
    if (predicate) {
      query = query.where(predicate);
    }

    const rows = (await query.toArray()) as LanceVectorRow[];
    return rows.map((row) => ({
      memory: deserializeLanceRow(row),
      score: distanceToSimilarity(row._distance),
      reasons: ["embedding"],
    }));
  }

  close() {
    this.table?.close();
    this.connection?.close();
    this.table = null;
    this.connection = null;
    this.initPromise = null;
  }

  private async initialize() {
    mkdirSync(this.lanceDir, { recursive: true });
    this.connection = await lancedb.connect(this.lanceDir);

    try {
      this.table = await this.connection.openTable("memory_vectors");
    } catch {
      this.table = null;
    }
  }

  private async ensureIndices(table: Table) {
    if (this.indicesEnsured) {
      return;
    }

    const rowCount = await table.countRows();
    const indices = await table.listIndices();
    const names = new Set(indices.map((index) => String((index as { name?: string }).name ?? "")));
    let vectorIndexReady = names.has("vector_idx");

    if (!vectorIndexReady && rowCount >= MIN_LANCE_PQ_TRAINING_ROWS) {
      try {
        await table.createIndex("vector", {
          config: lancedb.Index.hnswPq({
            distanceType: "cosine",
            numPartitions: 1,
          }),
        });
        vectorIndexReady = true;
      } catch (error) {
        if (!isInsufficientPqTrainingRowsError(error)) {
          throw error;
        }
      }
    }

    if (!names.has("id_idx")) {
      await table.createIndex("id");
    }

    if (!names.has("layer_idx")) {
      await table.createIndex("layer");
    }

    if (!names.has("project_idx")) {
      await table.createIndex("project");
    }

    this.indicesEnsured = vectorIndexReady;
  }
}

function isInsufficientPqTrainingRowsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Not enough rows to train PQ");
}

function serializeLanceRow(memory: Memory, vector: number[]): LanceVectorRow {
  return {
    id: memory.id,
    vector,
    layer: memory.layer,
    project: memory.project ?? "",
    salience: memory.salience,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    status: memory.status,
    title: memory.title,
    summary: memory.summary,
    details: memory.details,
    tags: JSON.stringify(memory.tags),
    sourceSessionId: memory.sourceSessionId,
    sourceAgent: memory.sourceAgent,
    sourceSessionIds: JSON.stringify(memory.sourceSessionIds),
    supportingMemoryIds: JSON.stringify(memory.supportingMemoryIds),
    linkedMemoryIds: JSON.stringify(memory.linkedMemoryIds),
    contradicts: JSON.stringify(memory.contradicts),
  };
}

function deserializeLanceRow(row: LanceVectorRow): Memory {
  return {
    id: row.id,
    layer: row.layer,
    title: row.title,
    summary: row.summary,
    details: row.details,
    tags: JSON.parse(row.tags) as string[],
    project: row.project || undefined,
    sourceSessionId: row.sourceSessionId,
    sourceAgent: row.sourceAgent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    status: (row.status || "observed") as Memory["status"],
    sourceSessionIds: JSON.parse(row.sourceSessionIds || "[]") as string[],
    supportingMemoryIds: JSON.parse(row.supportingMemoryIds || "[]") as string[],
    salience: row.salience,
    linkedMemoryIds: JSON.parse(row.linkedMemoryIds) as string[],
    contradicts: JSON.parse(row.contradicts) as string[],
  };
}

function buildLancePredicate(options: VectorStoreSearchOptions) {
  const clauses: string[] = [];

  if (options.project) {
    clauses.push(`project = ${sqlString(options.project)}`);
  }

  if (options.layers?.length) {
    clauses.push(`layer IN (${options.layers.map(sqlString).join(", ")})`);
  }

  if (options.excludeIds?.length) {
    clauses.push(`id NOT IN (${options.excludeIds.map(sqlString).join(", ")})`);
  }

  if (options.candidateIds?.length) {
    clauses.push(`id IN (${options.candidateIds.map(sqlString).join(", ")})`);
  }

  return clauses.join(" AND ");
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function distanceToSimilarity(distance: number | undefined) {
  if (!Number.isFinite(distance)) {
    return 0;
  }
  return Math.max(0, 1 - (distance ?? 0) / 2);
}

function encodeVector(vector: number[]) {
  return Buffer.from(new Float32Array(vector).buffer);
}

function decodeEmbeddingVector(row: Pick<EmbeddingRow, "vector_blob" | "vector">) {
  if (row.vector_blob && row.vector_blob.length > 0) {
    return Array.from(
      new Float32Array(
        row.vector_blob.buffer,
        row.vector_blob.byteOffset,
        row.vector_blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
      ),
    );
  }

  return row.vector ? (JSON.parse(row.vector) as number[]) : [];
}

function vectorNorm(vector: number[]) {
  if (vector.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

function cosineSimilarity(
  left: number[],
  right: number[],
  leftNorm = vectorNorm(left),
  rightNorm = vectorNorm(right),
) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
  }

  return dot / (leftNorm * rightNorm);
}
