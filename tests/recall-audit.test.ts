import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyAgentIntegration } from "../src/integrations";
import { runAgentRecallAudit } from "../src/recall-audit";
import { Storage } from "../src/storage";
import type { VectorStore } from "../src/storage/vector";
import type { Memory } from "../src/types";

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "procedural",
    title: "Auth retry flow",
    summary: "Refresh auth tokens before retrying failed API calls.",
    details: "Use the existing auth refresh helper before repeating the request.",
    tags: ["auth", "retry"],
    project: "proj-a",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "verified",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.9,
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
    optimize: async () => ({ backend: "sqlite", optimized: false, details: [] }),
    listCandidateIds: async () => [],
    search: async () => {
      throw new Error("audit should use fast recall without vector search");
    },
    close: () => {},
    ...overrides,
  };
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function createStorage(root: string) {
  const storage = new Storage({
    dbPath: join(root, "memory.db"),
    vaultPath: join(root, "vault"),
    vectorStore: createVectorStoreStub(),
  });
  await storage.saveMemories([makeMemory("auth-retry")]);
  return storage;
}

describe("agent recall audit loop", () => {
  it("verifies integration and recall repeatedly until the loop is clean", async () => {
    const root = join(tmpdir(), `mnemonic-recall-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    applyAgentIntegration(root, "all");
    const storage = await createStorage(root);

    const result = await runAgentRecallAudit(storage, {
      root,
      cwd: "/Users/me/Desktop/proj-a",
      task: "auth retry",
      iterations: 2,
      maxRecallMs: 250,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.iterations).toHaveLength(2);
    expect(result.integration.every((item) => item.installed)).toBe(true);
    expect(result.iterations.every((item) => item.recall.ok && item.recall.durationMs <= 250)).toBe(true);

    storage.close();
  });

  it("reports integration and latency issues instead of hiding them", async () => {
    const root = join(tmpdir(), `mnemonic-recall-audit-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    const storage = await createStorage(root);

    const result = await runAgentRecallAudit(storage, {
      root,
      cwd: "/Users/me/Desktop/proj-a",
      task: "auth retry",
      iterations: 1,
      maxRecallMs: -1,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("codex:missing-file");
    expect(result.issues.some((issue) => issue.includes("recall-latency-ms"))).toBe(true);

    storage.close();
  });
});
