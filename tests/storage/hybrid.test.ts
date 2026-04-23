import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { invalidateEmbeddingCache } from "../../src/embeddings";
import { Storage, effectiveSalience, fuseHits } from "../../src/storage";
import type { VectorStore } from "../../src/storage/vector";
import type { Memory, MemorySearchResult } from "../../src/types";

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: [],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.5,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

function hit(memory: Memory, score: number, reasons: string[]): MemorySearchResult {
  return { memory, score, reasons };
}

function createVectorStoreStub(): VectorStore {
  return {
    backend: () => "lancedb",
    init: async () => {},
    reset: async () => {},
    upsert: async () => {},
    get: async () => null,
    stats: async () => ({ indexed: 0, lastIndexedAt: null }),
    status: async () => ({ backend: "lancedb", indexed: 0, lastIndexedAt: null, indices: [] }),
    optimize: async () => ({ backend: "lancedb", optimized: false, details: [] }),
    listCandidateIds: async () => [],
    search: async () => [],
    close: () => {},
  };
}

const tempRoots: string[] = [];
const originalSettingsPath = process.env.MEMORY_AGENT_SETTINGS_PATH;

afterEach(() => {
  process.env.MEMORY_AGENT_SETTINGS_PATH = originalSettingsPath;
  invalidateEmbeddingCache();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("hybrid fusion", () => {
  it("preserves semantic-only hits instead of restricting to keyword candidates", () => {
    const keywordHits = [
      hit(makeMemory("k1"), 0.95, ["keyword"]),
      hit(makeMemory("k2"), 0.9, ["keyword"]),
    ];
    const semanticOnly = makeMemory("s1", { salience: 0.9 });
    const vectorHits = [
      hit(semanticOnly, 0.98, ["embedding"]),
      hit(makeMemory("k2"), 0.8, ["embedding"]),
    ];

    const results = fuseHits(keywordHits, vectorHits, 3, {
      keywordWeight: 1.2,
      semanticWeight: 1,
    });

    expect(results.map((result) => result.memory.id)).toContain("s1");
    expect(results.find((result) => result.memory.id === "k2")?.reasons.sort()).toEqual(["embedding", "keyword"]);
  });

  it("rewards agreement between keyword and semantic rankings", () => {
    const shared = makeMemory("shared");
    const loneKeyword = makeMemory("keyword-only");
    const loneVector = makeMemory("vector-only");

    const results = fuseHits(
      [
        hit(shared, 0.9, ["keyword"]),
        hit(loneKeyword, 0.85, ["keyword"]),
      ],
      [
        hit(shared, 0.88, ["embedding"]),
        hit(loneVector, 0.99, ["embedding"]),
      ],
      3,
    );

    expect(results[0]?.memory.id).toBe("shared");
  });

  it("decays old episodic salience more aggressively than durable memories", () => {
    const oldEpisodic = makeMemory("old-episodic", {
      layer: "episodic",
      salience: 1,
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const oldSemantic = makeMemory("old-semantic", {
      layer: "semantic",
      salience: 1,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const recent = makeMemory("recent", {
      layer: "episodic",
      salience: 1,
      createdAt: new Date().toISOString(),
    });

    expect(effectiveSalience(oldEpisodic, 30)).toBeLessThan(effectiveSalience(oldSemantic, 30));
    expect(effectiveSalience(oldEpisodic, 30)).toBeLessThan(effectiveSalience(recent, 30));
  });
});

describe("related memory lookup", () => {
  it("uses title and summary text to find related memories", async () => {
    const root = join(tmpdir(), `mnemonic-storage-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");
    invalidateEmbeddingCache();

    const storage = new Storage({
      dbPath: join(root, "memory.db"),
      vaultPath: join(root, "vault"),
      vectorStore: createVectorStoreStub(),
    });

    await storage.saveMemories([
      makeMemory("candidate-1", {
        title: "Auth refresh rotation middleware",
        summary: "Refresh token rotation fixes the retry loop",
        tags: ["security"],
      }),
      makeMemory("candidate-2", {
        title: "CLI rendering notes",
        summary: "TUI status line alignment",
        tags: ["ui"],
      }),
    ]);

    const [result] = await storage.findRelatedMemoriesBatch([
      makeMemory("query", {
        title: "Auth refresh rotation middleware",
        summary: "Retry loop fix",
        tags: ["unrelated-tag"],
      }),
    ]);

    expect(result?.map((hit) => hit.memory.id)).toContain("candidate-1");
    expect(result?.map((hit) => hit.memory.id)).not.toContain("candidate-2");

    storage.close();
  });

  it("filters text candidates by project in findRelatedMemoriesBatch", async () => {
    const root = join(tmpdir(), `mnemonic-storage-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");
    invalidateEmbeddingCache();

    const storage = new Storage({
      dbPath: join(root, "memory.db"),
      vaultPath: join(root, "vault"),
      vectorStore: createVectorStoreStub(),
    });

    await storage.saveMemories([
      makeMemory("candidate-alpha", {
        project: "alpha",
        title: "Shared retrieval phrase",
        summary: "Common related memory terms",
        details: "Alpha-only candidate",
      }),
      makeMemory("candidate-beta", {
        project: "beta",
        title: "Shared retrieval phrase",
        summary: "Common related memory terms",
        details: "Beta-only candidate",
      }),
    ]);

    const [result] = await storage.findRelatedMemoriesBatch([
      makeMemory("query-alpha", {
        project: "alpha",
        title: "Shared retrieval phrase",
        summary: "Common related memory terms",
      }),
    ]);

    expect(result?.map((hit) => hit.memory.id)).toContain("candidate-alpha");
    expect(result?.map((hit) => hit.memory.id)).not.toContain("candidate-beta");

    storage.close();
  });
});
