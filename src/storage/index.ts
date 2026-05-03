import { loadConfig, type Config } from "../config";
import { embedTexts, hasEmbeddingProvider } from "../embeddings";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { MemoryDB } from "./sqlite";
import { MarkdownVault } from "./markdown";
import { createVectorStore, type VectorStore } from "./vector";
import type { Memory, MemoryLayer, MemorySearchResult } from "../types";
import { deduplicateMemoryCorpus } from "./deduplicate";

export interface StorageOptions {
  config?: Config;
  dbPath?: string;
  vaultPath?: string;
  vectorStore?: VectorStore;
}

export interface PruneResult {
  total: number;
  pruned: Memory[];
  kept: Memory[];
  byLayer: Map<string, number>;
}

export interface MaintenanceRunResult {
  checked: boolean;
  performed: boolean;
  reason: "initialized" | "check-not-due" | "maintenance-not-due" | "executed";
  checkedAt: string;
  previousMaintenanceAt: string | null;
  lastMaintenanceAt: string | null;
  reportPath?: string;
  proposedDowngraded: number;
  lowSalienceEpisodicCandidates: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const LOW_SALIENCE_EPISODIC_SWEEP_THRESHOLD = 0.3;
const LOW_SALIENCE_EPISODIC_SWEEP_AGE_DAYS = 30;
const PROPOSED_DECAY_AGE_DAYS = 60;
const PROPOSED_DECAY_AMOUNT = 0.2;
const MAINTENANCE_META_KEY = "lastMaintenanceAt";
const MAINTENANCE_CHECK_META_KEY = "lastMaintenanceCheckAt";

export class Storage {
  readonly db: MemoryDB;
  readonly vault: MarkdownVault;
  readonly vectorStore: VectorStore;
  readonly config: Config;
  private initPromise: Promise<void> | null = null;

  constructor(options: StorageOptions = {}) {
    const config = options.config ?? loadConfig();
    this.config = config;
    const dbPath = options.dbPath ?? config.sqlitePath;
    this.db = new MemoryDB(dbPath);
    this.vault = new MarkdownVault(options.vaultPath ?? config.vault);
    this.vectorStore = options.vectorStore ?? createVectorStore({ dbPath, lanceDir: config.lanceDir, config });
  }

  async init() {
    this.refreshViews();
    await this.ensureInitialized();
  }

  async saveMemory(mem: Memory) {
    await this.saveMemories([mem]);
  }

  async saveMemories(memories: Memory[]) {
    if (memories.length === 0) {
      return;
    }

    await this.ensureInitialized();
    this.db.withTransaction(() => {
      this.persistMemories(memories);
    });
    await this.materializeMemories(memories);
  }

  getMemory(id: string) {
    return this.db.getMemory(id);
  }

  searchText(query: string, limit = 20) {
    return this.db.searchMemories(query, limit);
  }

  listByLayer(layer: MemoryLayer, limit = 50) {
    return this.db.listByLayer(layer, limit);
  }

  listRecent(limit = 50) {
    return this.db.listRecent(limit);
  }

  listAll() {
    return this.db.listAll();
  }

  listContradictions(limit = 20) {
    return this.db.getContradictions(limit);
  }

  isProcessed(path: string, hash: string) {
    return this.db.isFileProcessed(path, hash);
  }

  markProcessed(path: string, hash: string, sessionId: string) {
    this.db.markFileProcessed(path, hash, sessionId);
  }

  async recordProcessedSession(memories: Memory[], path: string, hash: string, sessionId: string) {
    await this.ensureInitialized();
    this.db.withTransaction(() => {
      this.persistMemories(memories);
    });
    await this.materializeMemories(memories);
    this.db.markFileProcessed(path, hash, sessionId);
    await this.runWeeklyMaintenanceIfDue();
  }

  rebuildIndex() {
    this.refreshViews();
  }

  async search(query: string, limit = 20): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();
    const textMatches = this.db.searchMemories(query, Math.max(limit * 4, 20));
    const textResults = rankResults(textMatches, "keyword", limit);

    if (!hasEmbeddingProvider(undefined, this.config)) {
      return textResults.slice(0, limit);
    }

    try {
      const [embedded] = await embedTexts([query], { config: this.config });
      if (!embedded) {
        return textResults.slice(0, limit);
      }

      const vectorResults = await this.vectorStore.search(embedded.values, limit * 3, {
        candidateIds: await this.getSemanticCandidateIds(limit, textMatches.map((memory) => memory.id)),
      });

      return fuseHits(textResults, vectorResults, limit, {
        keywordWeight: 1.2,
        semanticWeight: 1,
      });
    } catch {
      return textResults.slice(0, limit);
    }
  }

  async findRelatedMemories(
    memory: Memory,
    options: {
      limit?: number;
      layers?: MemoryLayer[];
    } = {},
  ): Promise<MemorySearchResult[]> {
    const [results] = await this.findRelatedMemoriesBatch([memory], options);
    return results ?? [];
  }

  async findRelatedMemoriesBatch(
    memories: Memory[],
    options: {
      limit?: number;
      layers?: MemoryLayer[];
    } = {},
  ): Promise<MemorySearchResult[][]> {
    await this.ensureInitialized();
    const limit = options.limit ?? 10;
    const textResultsByMemory = memories.map((memory) => {
      const textMatches = this.searchText(buildRelatedMemoryQuery(memory), Math.max(limit * 4, 20))
        .filter((candidate) => candidate.id !== memory.id)
        .filter((candidate) => (options.layers ? options.layers.includes(candidate.layer) : true))
        .filter((candidate) => (!memory.project || !candidate.project || candidate.project === memory.project));

      return rankResults(textMatches, "keyword", limit);
    });

    if (!hasEmbeddingProvider(undefined, this.config)) {
      return textResultsByMemory.map((results) => results.slice(0, limit));
    }

    try {
      const vectors = await embedTexts(
        memories.map((memory) => [memory.title, memory.summary, memory.details].filter(Boolean).join("\n")),
        { config: this.config },
      );

      return Promise.all(memories.map(async (memory, index) => {
        const textResults = textResultsByMemory[index] ?? [];
        const vector = vectors[index];
        if (!vector) {
          return textResults.slice(0, limit);
        }

        const vectorResults = await this.vectorStore.search(vector.values, limit * 3, {
          excludeIds: [memory.id],
          layers: options.layers,
          project: memory.project,
          candidateIds: await this.getSemanticCandidateIds(
            limit,
            textResults.map((hit) => hit.memory.id),
            {
              layers: options.layers,
              project: memory.project,
              excludeIds: [memory.id],
            },
          ),
        });

        return fuseHits(textResults, vectorResults, limit, {
          keywordWeight: 1.1,
          semanticWeight: 1,
        });
      }));
    } catch {
      return textResultsByMemory.map((results) => results.slice(0, limit));
    }
  }

  async reindex(log: (message: string) => void = () => {}) {
    await this.ensureInitialized();
    const memories = this.listAll();
    const indexed = await this.indexMemories(memories).catch(() => 0);
    const optimize = await this.vectorStore.optimize().catch(() => null);
    this.refreshViews();
    log(`Indexed ${indexed}/${memories.length} memories.`);
    if (optimize?.details.length) {
      log(`Vector optimize: ${optimize.details.join("; ")}`);
    }
    return { total: memories.length, indexed };
  }

  async stats() {
    await this.ensureInitialized();
    const vector = await this.vectorStore.status();
    return {
      totalMemories: this.db.countMemories(),
      contradictions: this.db.countContradictions(),
      embeddingIndexed: vector.indexed,
      lastIndexedAt: vector.lastIndexedAt,
      lastMaintenanceAt: this.db.getMeta(MAINTENANCE_META_KEY),
      vector,
    };
  }

  async runWeeklyMaintenanceIfDue(log: (message: string) => void = () => {}): Promise<MaintenanceRunResult> {
    await this.ensureInitialized();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const previousMaintenanceAt = this.db.getMeta(MAINTENANCE_META_KEY);
    const lastCheckedAt = this.db.getMeta(MAINTENANCE_CHECK_META_KEY);
    if (lastCheckedAt && nowMs - new Date(lastCheckedAt).getTime() < ONE_DAY_MS) {
      return {
        checked: false,
        performed: false,
        reason: "check-not-due",
        checkedAt: nowIso,
        previousMaintenanceAt,
        lastMaintenanceAt: previousMaintenanceAt,
        proposedDowngraded: 0,
        lowSalienceEpisodicCandidates: 0,
      };
    }

    this.db.setMeta(MAINTENANCE_CHECK_META_KEY, nowIso);
    if (!previousMaintenanceAt) {
      this.db.setMeta(MAINTENANCE_META_KEY, nowIso);
      return {
        checked: true,
        performed: false,
        reason: "initialized",
        checkedAt: nowIso,
        previousMaintenanceAt: null,
        lastMaintenanceAt: nowIso,
        proposedDowngraded: 0,
        lowSalienceEpisodicCandidates: 0,
      };
    }

    const previousMs = new Date(previousMaintenanceAt).getTime();
    if (!Number.isFinite(previousMs) || nowMs - previousMs < ONE_WEEK_MS) {
      return {
        checked: true,
        performed: false,
        reason: "maintenance-not-due",
        checkedAt: nowIso,
        previousMaintenanceAt,
        lastMaintenanceAt: previousMaintenanceAt,
        proposedDowngraded: 0,
        lowSalienceEpisodicCandidates: 0,
      };
    }

    const beforeMemories = this.listAll();
    const lowSalienceEpisodicCandidates = beforeMemories.filter((memory) =>
      isMaintenanceLowSalienceEpisodic(memory, beforeMemories, nowMs),
    ).length;
    await this.applyLowSalienceEpisodicSweep(nowMs);
    const proposedDowngraded = await this.applyProposedDecaySweep(nowMs);

    const optimizeResult = await this.optimize(log);
    this.db.setMeta(MAINTENANCE_META_KEY, nowIso);

    const reportPath = this.writeMaintenanceReport({
      checkedAt: nowIso,
      previousMaintenanceAt,
      lowSalienceEpisodicCandidates,
      proposedDowngraded,
      optimizeDetails: optimizeResult.details,
      totalBefore: beforeMemories.length,
      totalAfter: this.db.countMemories(),
    });

    return {
      checked: true,
      performed: true,
      reason: "executed",
      checkedAt: nowIso,
      previousMaintenanceAt,
      lastMaintenanceAt: nowIso,
      reportPath,
      proposedDowngraded,
      lowSalienceEpisodicCandidates,
    };
  }

  async optimize(log: (message: string) => void = () => {}) {
    await this.ensureInitialized();
    const currentMemories = this.listAll();

    const pruneThreshold = 0.45;
    const pruneAgeDays = 14;
    const now = Date.now();
    const pruned = currentMemories.filter((memory) => {
      if (memory.layer !== "episodic" || memory.salience >= pruneThreshold) return true;
      if (hasIncomingLinks(memory, currentMemories)) return true;
      const age = now - new Date(memory.createdAt).getTime();
      return age < pruneAgeDays * 86_400_000;
    });
    const prunedCount = currentMemories.length - pruned.length;
    if (prunedCount > 0) {
      log(`Pruned ${prunedCount} low-salience episodic memories (salience < ${pruneThreshold}, age > ${pruneAgeDays}d)`);
    }

    const deduplicated = deduplicateMemoryCorpus(pruned);

    if (prunedCount > 0 || deduplicated.report.removed > 0) {
      this.db.withTransaction(() => {
        this.db.replaceAllMemories(deduplicated.memories);
      });
      await this.vectorStore.reset();
      this.vault.resetGeneratedMemoryViews();
      await this.materializeMemories(deduplicated.memories);
      if (deduplicated.report.removed > 0) {
        log(
          `Deduplicated memories: removed=${deduplicated.report.removed} mergedGroups=${deduplicated.report.mergedGroups}`,
        );
      }
    }

    const result = await this.vectorStore.optimize();
    if (result.details.length > 0) {
      log(result.details.join("; "));
    }
    return {
      ...result,
      details: [
        ...(
          deduplicated.report.removed > 0
            ? [
                `deduplicated=${deduplicated.report.removed}`,
                `mergedGroups=${deduplicated.report.mergedGroups}`,
                `remaining=${deduplicated.report.totalAfter}`,
              ]
            : ["deduplicated=0"]
        ),
        ...result.details,
      ],
    };
  }

  async prune(
    predicate: (memory: Memory) => boolean,
    options: {
      dryRun?: boolean;
    } = {},
  ): Promise<PruneResult> {
    await this.ensureInitialized();
    const all = this.listAll();
    const pruned = all.filter(predicate);
    const prunedIds = new Set(pruned.map((memory) => memory.id));
    const kept = all.filter((memory) => !prunedIds.has(memory.id));
    const byLayer = new Map<string, number>();

    for (const memory of pruned) {
      byLayer.set(memory.layer, (byLayer.get(memory.layer) ?? 0) + 1);
    }

    if (!options.dryRun && pruned.length > 0) {
      this.db.withTransaction(() => {
        this.db.replaceAllMemories(kept);
      });
      await this.vectorStore.reset();
      this.vault.resetGeneratedMemoryViews();
      await this.materializeMemories(kept);
    }

    return {
      total: all.length,
      pruned,
      kept,
      byLayer,
    };
  }

  async reset(log: (message: string) => void = () => {}) {
    await this.ensureInitialized();
    this.db.resetMemoryState();
    await this.vectorStore.reset();
    this.vault.resetGeneratedMemoryViews();
    this.refreshViews();
    log("Cleared memories, vector index, processed state, and generated memory views.");
  }

  close() {
    this.db.close();
    this.vectorStore.close();
  }

  private async ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = this.vectorStore.init();
    }
    await this.initPromise;
  }

  private async getSemanticCandidateIds(
    limit: number,
    prioritizedIds: string[],
    options: {
      layers?: MemoryLayer[];
      project?: string;
      excludeIds?: string[];
    } = {},
  ) {
    if (this.vectorStore.backend() === "lancedb") {
      return undefined;
    }

    const backgroundIds = await this.vectorStore.listCandidateIds(Math.max(limit * 6, 64), options);
    return Array.from(new Set([...prioritizedIds, ...backgroundIds]));
  }

  private async indexMemories(memories: Memory[]) {
    if (!hasEmbeddingProvider(undefined, this.config)) {
      return 0;
    }

    const payloads = memories.map((memory) => ({
      memory,
      text: [memory.title, memory.summary, memory.details].filter(Boolean).join("\n"),
    }));

    const vectors = await embedTexts(payloads.map((item) => item.text), { config: this.config });
    for (const [index, payload] of payloads.entries()) {
      const vector = vectors[index];
      if (!vector) {
        continue;
      }
      await this.vectorStore.upsert(payload.memory, vector.values, vector.model);
    }

    return vectors.length;
  }

  private persistMemories(memories: Memory[]) {
    for (const memory of memories) {
      this.db.upsertMemory(memory);
    }
  }

  private async materializeMemories(memories: Memory[]) {
    for (const memory of memories) {
      this.vault.writeMemory(memory);
    }

    await this.indexMemories(memories);
    this.refreshViews();
  }

  private async applyLowSalienceEpisodicSweep(nowMs: number) {
    const all = this.listAll();
    const kept = all.filter((memory) => !isMaintenanceLowSalienceEpisodic(memory, all, nowMs));
    if (kept.length === all.length) {
      return 0;
    }

    this.db.withTransaction(() => {
      this.db.replaceAllMemories(kept);
    });
    await this.vectorStore.reset();
    this.vault.resetGeneratedMemoryViews();
    await this.materializeMemories(kept);
    return all.length - kept.length;
  }

  private async applyProposedDecaySweep(nowMs: number) {
    const all = this.listAll();
    let changed = 0;
    const next = all.map((memory) => {
      if (memory.status !== "proposed") {
        return memory;
      }

      if ((memory.supportingMemoryIds ?? []).length > 0) {
        return memory;
      }

      const ageMs = nowMs - new Date(memory.updatedAt || memory.createdAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs < PROPOSED_DECAY_AGE_DAYS * ONE_DAY_MS) {
        return memory;
      }

      const nextSalience = clampSalience(memory.salience - PROPOSED_DECAY_AMOUNT);
      if (nextSalience >= memory.salience) {
        return memory;
      }

      changed += 1;
      return {
        ...memory,
        salience: nextSalience,
        updatedAt: new Date(nowMs).toISOString(),
      };
    });

    if (changed > 0) {
      this.db.withTransaction(() => {
        this.db.replaceAllMemories(next);
      });
      await this.vectorStore.reset();
      this.vault.resetGeneratedMemoryViews();
      await this.materializeMemories(next);
    }

    return changed;
  }

  private refreshViews() {
    const all = this.db.listAll();
    this.vault.rebuildIndex(all);
  }

  private writeMaintenanceReport(input: {
    checkedAt: string;
    previousMaintenanceAt: string | null;
    lowSalienceEpisodicCandidates: number;
    proposedDowngraded: number;
    optimizeDetails: string[];
    totalBefore: number;
    totalAfter: number;
  }) {
    const date = input.checkedAt.slice(0, 10);
    const directory = join(this.config.vault, "maintenance");
    const reportPath = join(directory, `${date}.md`);
    const report = [
      `# Maintenance Report ${date}`,
      "",
      `- checkedAt: ${input.checkedAt}`,
      `- previousMaintenanceAt: ${input.previousMaintenanceAt ?? "(none)"}`,
      `- lowSalienceEpisodicCandidates: ${input.lowSalienceEpisodicCandidates}`,
      `- proposedDowngraded: ${input.proposedDowngraded}`,
      `- totalBefore: ${input.totalBefore}`,
      `- totalAfter: ${input.totalAfter}`,
      "",
      "## Optimize",
      "",
      ...(input.optimizeDetails.length > 0 ? input.optimizeDetails.map((line) => `- ${line}`) : ["- (no details)"]),
      "",
    ].join("\n");

    mkdirSync(directory, { recursive: true });
    writeFileSync(reportPath, report);
    return reportPath;
  }
}

function rankResults(
  memories: MemorySearchResult["memory"][],
  reason: "keyword",
  limit: number,
) {
  return memories.map((memory, index) => ({
    memory,
    score: Math.max(0.1, 1 - index / Math.max(limit * 3, 12)) + effectiveSalience(memory) * 0.05,
    reasons: [reason],
  }));
}

function buildRelatedMemoryQuery(memory: Memory) {
  const queryText = [memory.title, memory.summary].filter(Boolean).join(" ").trim();
  if (queryText.length > 0) {
    return queryText;
  }

  return memory.tags.join(" ");
}

export function effectiveSalience(memory: Memory, halfLifeDays = 90): number {
  const referenceTime = (memory.layer !== "episodic" && memory.updatedAt)
    ? new Date(memory.updatedAt).getTime()
    : new Date(memory.createdAt).getTime();
  if (!Number.isFinite(referenceTime)) {
    return memory.salience;
  }

  const ageMs = Math.max(0, Date.now() - referenceTime);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decay = Math.pow(0.5, ageDays / halfLifeDays);
  const layerFactor = memory.layer === "episodic" ? 1 : 0.5;

  let statusFactor = 1;
  if (memory.status === "proposed") statusFactor = 0.3;
  if (memory.status === "superseded") statusFactor = 0.1;

  return memory.salience * (1 - layerFactor + layerFactor * decay) * statusFactor;
}

export function fuseHits(
  left: MemorySearchResult[],
  right: MemorySearchResult[],
  limit: number,
  weights: {
    keywordWeight?: number;
    semanticWeight?: number;
    k?: number;
  } = {},
) {
  const merged = new Map<string, MemorySearchResult & { fusedScore: number }>();
  const k = weights.k ?? 50;
  const leftWeight = weights.keywordWeight ?? 1;
  const rightWeight = weights.semanticWeight ?? 1;

  for (const [index, hit] of left.entries()) {
    const reciprocal = leftWeight / (k + index + 1);
    const existing = merged.get(hit.memory.id);
    if (!existing) {
      merged.set(hit.memory.id, {
        ...hit,
        reasons: [...hit.reasons],
        fusedScore: reciprocal + hit.score * 0.15 + effectiveSalience(hit.memory) * 0.05,
      });
      continue;
    }

    existing.fusedScore += reciprocal;
    existing.score = Math.max(existing.score, hit.score);
    existing.reasons = Array.from(new Set([...existing.reasons, ...hit.reasons]));
  }

  for (const [index, hit] of right.entries()) {
    const reciprocal = rightWeight / (k + index + 1);
    const existing = merged.get(hit.memory.id);
    if (!existing) {
      merged.set(hit.memory.id, {
        ...hit,
        reasons: [...hit.reasons],
        fusedScore: reciprocal + hit.score * 0.15 + effectiveSalience(hit.memory) * 0.05,
      });
      continue;
    }

    existing.fusedScore += reciprocal;
    existing.score = Math.max(existing.score, hit.score);
    existing.reasons = Array.from(new Set([...existing.reasons, ...hit.reasons]));
  }

  return [...merged.values()]
    .sort(
      (a, b) =>
        b.fusedScore - a.fusedScore ||
        b.score - a.score ||
        effectiveSalience(b.memory) - effectiveSalience(a.memory),
    )
    .map(({ fusedScore: _fusedScore, ...hit }) => hit)
    .slice(0, limit);
}

function isMaintenanceLowSalienceEpisodic(memory: Memory, corpus: Memory[], nowMs: number) {
  if (memory.layer !== "episodic" || memory.salience >= LOW_SALIENCE_EPISODIC_SWEEP_THRESHOLD) {
    return false;
  }

  const ageMs = nowMs - new Date(memory.createdAt).getTime();
  return (
    Number.isFinite(ageMs) &&
    ageMs >= LOW_SALIENCE_EPISODIC_SWEEP_AGE_DAYS * ONE_DAY_MS &&
    !hasIncomingLinks(memory, corpus)
  );
}

function hasIncomingLinks(memory: Memory, corpus: Memory[]) {
  return corpus.some((candidate) => {
    if (candidate.id === memory.id) {
      return false;
    }

    return (
      candidate.linkedMemoryIds.includes(memory.id) ||
      candidate.supportingMemoryIds.includes(memory.id) ||
      candidate.contradicts.includes(memory.id)
    );
  });
}

function clampSalience(value: number) {
  return Math.max(0, Math.min(1, value));
}
