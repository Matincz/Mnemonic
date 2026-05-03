import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invalidateEmbeddingCache } from "../../src/embeddings/index";
import { Storage } from "../../src/storage";
import type { VectorStore } from "../../src/storage/vector";
import type { Memory } from "../../src/types";

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
    createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.7,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

function createVectorStoreStub(overrides: Partial<VectorStore> = {}): VectorStore {
  return {
    backend: () => "sqlite",
    init: async () => {},
    reset: async () => {},
    upsert: async () => {},
    get: async () => null,
    stats: async () => ({ indexed: 0, lastIndexedAt: null }),
    status: async () => ({ backend: "sqlite", indexed: 0, lastIndexedAt: null, indices: [] }),
    optimize: async () => ({ backend: "sqlite", optimized: false, details: ["sqlite backend optimize skipped"] }),
    listCandidateIds: async () => [],
    search: async () => [],
    close: () => {},
    ...overrides,
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

describe("weekly maintenance", () => {
  it("initializes maintenance metadata without running optimize", async () => {
    const root = join(tmpdir(), `mnemonic-maint-init-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");
    invalidateEmbeddingCache();

    const storage = new Storage({
      dbPath: join(root, "memory.db"),
      vaultPath: join(root, "vault"),
      vectorStore: createVectorStoreStub(),
    });

    const result = await storage.runWeeklyMaintenanceIfDue();
    expect(result.reason).toBe("initialized");
    expect(result.performed).toBe(false);
    expect(storage.db.getMeta("lastMaintenanceAt")).toBeTruthy();
    expect(storage.db.getMeta("lastMaintenanceCheckAt")).toBeTruthy();
    storage.close();
  });

  it("checks at most once every 24h", async () => {
    const root = join(tmpdir(), `mnemonic-maint-check-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");
    invalidateEmbeddingCache();

    const storage = new Storage({
      dbPath: join(root, "memory.db"),
      vaultPath: join(root, "vault"),
      vectorStore: createVectorStoreStub(),
    });
    await storage.init();
    const now = new Date().toISOString();
    storage.db.setMeta("lastMaintenanceAt", new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());
    storage.db.setMeta("lastMaintenanceCheckAt", now);

    const result = await storage.runWeeklyMaintenanceIfDue();
    expect(result.reason).toBe("check-not-due");
    expect(result.performed).toBe(false);
    storage.close();
  });

  it("runs overdue weekly maintenance, applies sweeps, and writes a report", async () => {
    const root = join(tmpdir(), `mnemonic-maint-run-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");
    invalidateEmbeddingCache();

    const storage = new Storage({
      dbPath: join(root, "memory.db"),
      vaultPath: join(root, "vault"),
      vectorStore: createVectorStoreStub(),
    });
    await storage.init();

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const veryOld = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();
    await storage.saveMemories([
      makeMemory("old-low-episodic", {
        layer: "episodic",
        salience: 0.2,
        createdAt: old,
        updatedAt: old,
      }),
      makeMemory("linked-low-episodic", {
        layer: "episodic",
        salience: 0.2,
        createdAt: old,
        updatedAt: old,
      }),
      makeMemory("semantic-link", {
        layer: "semantic",
        linkedMemoryIds: ["linked-low-episodic"],
      }),
      makeMemory("old-proposed", {
        layer: "semantic",
        status: "proposed",
        salience: 0.8,
        createdAt: veryOld,
        updatedAt: veryOld,
      }),
    ]);

    storage.db.setMeta("lastMaintenanceAt", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());
    storage.db.setMeta("lastMaintenanceCheckAt", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());

    const result = await storage.runWeeklyMaintenanceIfDue();
    expect(result.reason).toBe("executed");
    expect(result.performed).toBe(true);
    expect(result.lowSalienceEpisodicCandidates).toBeGreaterThanOrEqual(1);
    expect(result.proposedDowngraded).toBeGreaterThanOrEqual(1);
    expect(result.reportPath).toBeTruthy();
    expect(existsSync(result.reportPath!)).toBe(true);
    expect(readFileSync(result.reportPath!, "utf8")).toContain("proposedDowngraded");

    expect(storage.getMemory("old-low-episodic")).toBeNull();
    expect(storage.getMemory("linked-low-episodic")).not.toBeNull();
    expect(storage.getMemory("old-proposed")?.salience).toBeCloseTo(0.6, 6);
    storage.close();
  });
});
