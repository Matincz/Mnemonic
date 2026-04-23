import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { Memory, MemoryLayer } from "../types";
import { rowToMemory, type SqlMemoryRow } from "./serialize";

interface CountRow {
  count: number;
}

interface PipelineCheckpointRow {
  stage: string;
  payload: string;
}

export class MemoryDB {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT,
        source_session_id TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'observed',
        source_session_ids TEXT NOT NULL DEFAULT '[]',
        supporting_memory_ids TEXT NOT NULL DEFAULT '[]',
        salience REAL NOT NULL DEFAULT 0.5,
        linked_memory_ids TEXT NOT NULL DEFAULT '[]',
        contradicts TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS processed_files (
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT NOT NULL,
        PRIMARY KEY (path, hash)
      );

      CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
        session_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, stage)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        memory_id UNINDEXED,
        title,
        summary,
        details,
        tokenize = 'porter unicode61'
      );

      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_agent);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_salience ON memories(salience DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
    `);

    for (const stmt of [
      "ALTER TABLE memories ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'observed'",
      "ALTER TABLE memories ADD COLUMN source_session_ids TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE memories ADD COLUMN supporting_memory_ids TEXT NOT NULL DEFAULT '[]'",
    ]) {
      try {
        this.db.exec(stmt);
      } catch {
        // Column already exists
      }
    }

    this.rebuildTextIndexIfNeeded();
  }

  upsertMemory(mem: Memory) {
    this.db.prepare(`
      INSERT OR REPLACE INTO memories
      (id, layer, title, summary, details, tags, project,
       source_session_id, source_agent, created_at, updated_at, status,
       source_session_ids, supporting_memory_ids, salience, linked_memory_ids, contradicts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mem.id, mem.layer, mem.title, mem.summary, mem.details,
      JSON.stringify(mem.tags), mem.project ?? null,
      mem.sourceSessionId, mem.sourceAgent, mem.createdAt, mem.updatedAt, mem.status,
      JSON.stringify(mem.sourceSessionIds), JSON.stringify(mem.supportingMemoryIds), mem.salience,
      JSON.stringify(mem.linkedMemoryIds), JSON.stringify(mem.contradicts),
    );

    this.syncTextIndex(mem);
  }

  replaceAllMemories(memories: Memory[]) {
    this.db.exec(`
      DELETE FROM memories_fts;
      DELETE FROM memories;
    `);

    for (const memory of memories) {
      this.upsertMemory(memory);
    }
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as SqlMemoryRow | null;
    return row ? rowToMemory(row) : null;
  }

  searchMemories(query: string, limit = 20): Memory[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    try {
      const rows = this.db.prepare(`
        SELECT m.*
        FROM memories_fts f
        JOIN memories m ON m.id = f.memory_id
        WHERE memories_fts MATCH ?
        ORDER BY bm25(memories_fts), m.salience DESC, m.created_at DESC
        LIMIT ?
      `).all(ftsQuery, limit) as SqlMemoryRow[];
      return rows.map((row) => rowToMemory(row));
    } catch {
      const like = `%${query.trim()}%`;
      const rows = this.db.prepare(`
        SELECT * FROM memories
        WHERE title LIKE ? OR summary LIKE ? OR details LIKE ?
        ORDER BY salience DESC, created_at DESC
        LIMIT ?
      `).all(like, like, like, limit) as SqlMemoryRow[];
      return rows.map((row) => rowToMemory(row));
    }
  }

  listByLayer(layer: MemoryLayer, limit = 50): Memory[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories WHERE layer = ? ORDER BY created_at DESC LIMIT ?",
    ).all(layer, limit) as SqlMemoryRow[];
    return rows.map((row) => rowToMemory(row));
  }

  listRecent(limit = 50): Memory[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?",
    ).all(limit) as SqlMemoryRow[];
    return rows.map((row) => rowToMemory(row));
  }

  listAll(): Memory[] {
    const rows = this.db.prepare("SELECT * FROM memories ORDER BY created_at DESC").all() as SqlMemoryRow[];
    return rows.map((row) => rowToMemory(row));
  }

  countMemories(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as CountRow | null;
    return row?.count ?? 0;
  }

  countContradictions(): number {
    const rows = this.db.prepare("SELECT contradicts FROM memories").all() as Array<{ contradicts: string }>;
    return rows.reduce((count, row) => count + JSON.parse(row.contradicts).length, 0);
  }

  resetMemoryState() {
    this.db.exec(`
      DELETE FROM memories_fts;
      DELETE FROM processed_files;
      DELETE FROM pipeline_checkpoints;
      DELETE FROM memories;
    `);
  }

  getContradictions(limit = 20): Memory[] {
    return this.listAll()
      .filter((memory) => memory.contradicts.length > 0)
      .slice(0, limit);
  }

  markFileProcessed(path: string, hash: string, sessionId: string) {
    this.db.prepare(
      "INSERT OR REPLACE INTO processed_files (path, hash, session_id) VALUES (?, ?, ?)",
    ).run(path, hash, sessionId);
  }

  isFileProcessed(path: string, hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM processed_files WHERE path = ? AND hash = ?",
    ).get(path, hash);
    return !!row;
  }

  saveCheckpoint(sessionId: string, stage: string, payload: unknown) {
    this.db.prepare(
      `INSERT OR REPLACE INTO pipeline_checkpoints (session_id, stage, payload, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(sessionId, stage, JSON.stringify(payload), new Date().toISOString());
  }

  loadCheckpoint<T>(sessionId: string, stage: string): T | null {
    const row = this.db.prepare(
      "SELECT stage, payload FROM pipeline_checkpoints WHERE session_id = ? AND stage = ?",
    ).get(sessionId, stage) as PipelineCheckpointRow | null;

    if (!row) {
      return null;
    }

    return JSON.parse(row.payload) as T;
  }

  clearCheckpoints(sessionId: string) {
    this.db.prepare("DELETE FROM pipeline_checkpoints WHERE session_id = ?").run(sessionId);
  }

  withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  private rebuildTextIndexIfNeeded() {
    const memoryCount = this.countMemories();
    const ftsCountRow = this.db.prepare("SELECT COUNT(*) as count FROM memories_fts").get() as CountRow | null;
    const ftsCount = ftsCountRow?.count ?? 0;

    if (memoryCount === ftsCount) {
      return;
    }

    this.db.exec("DELETE FROM memories_fts");
    this.db.prepare(`
      INSERT INTO memories_fts (memory_id, title, summary, details)
      SELECT id, title, summary, details FROM memories
    `).run();
  }

  private syncTextIndex(mem: Memory) {
    this.db.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(mem.id);
    this.db.prepare(`
      INSERT INTO memories_fts (memory_id, title, summary, details)
      VALUES (?, ?, ?, ?)
    `).run(mem.id, mem.title, mem.summary, mem.details);
  }
}

function buildFtsQuery(query: string) {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*]/g, "").trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "";
  }

  return tokens.map((token) => `${token}*`).join(" AND ");
}
