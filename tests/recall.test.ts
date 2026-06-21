import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { invalidateEmbeddingCache } from "../src/embeddings";
import { buildRecallCapsule } from "../src/recall";
import { Storage } from "../src/storage";
import type { VectorStore } from "../src/storage/vector";
import type { Memory } from "../src/types";

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: [],
    project: "proj-a",
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

async function createStorage() {
  const root = join(tmpdir(), `mnemonic-recall-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");

  const storage = new Storage({
    dbPath: join(root, "memory.db"),
    vaultPath: join(root, "vault"),
    vectorStore: createVectorStoreStub(),
  });
  await storage.init();
  return storage;
}

describe("agent recall capsule", () => {
  it("returns concise project-scoped context for the current cwd", async () => {
    const storage = await createStorage();
    await storage.saveMemories([
      makeMemory("proj-a-auth", {
        layer: "procedural",
        title: "Auth retry flow",
        summary: "Refresh auth tokens before retrying failed API calls.",
        details: "Use the existing auth refresh helper before repeating the request.",
        project: "proj-a",
        salience: 0.9,
        status: "verified",
      }),
      makeMemory("proj-b-auth", {
        title: "Auth retry flow",
        summary: "Different project auth retry notes.",
        details: "This should not leak into proj-a recall.",
        project: "proj-b",
        salience: 0.9,
      }),
    ]);

    const capsule = await buildRecallCapsule(storage, {
      task: "auth retry failing request",
      cwd: "/Users/me/Desktop/proj-a",
    });

    expect(capsule.project).toBe("proj-a");
    expect(capsule.memories.map((memory) => memory.id)).toEqual(["proj-a-auth"]);
    expect(capsule.memories[0]?.whyIncluded).toContain("project");
    expect(capsule.context).toContain("Relevant memory:");
    expect(capsule.context).toContain("Auth retry flow");

    storage.close();
  });

  it("filters low-confidence statuses out of automatic recall", async () => {
    const storage = await createStorage();
    await storage.saveMemories([
      makeMemory("observed-deploy", {
        layer: "insight",
        title: "Deploy verification",
        summary: "Always verify the live endpoint after deployment.",
        details: "Deployment command success is not enough.",
        status: "observed",
        salience: 0.8,
      }),
      makeMemory("proposed-deploy", {
        title: "Deploy verification",
        summary: "Unverified proposed deployment idea.",
        details: "This should stay out of automatic recall.",
        status: "proposed",
        salience: 1,
      }),
      makeMemory("superseded-deploy", {
        title: "Deploy verification",
        summary: "Old superseded deployment flow.",
        details: "This should stay out of automatic recall.",
        status: "superseded",
        salience: 1,
      }),
    ]);

    const capsule = await buildRecallCapsule(storage, {
      task: "deploy verification",
      cwd: "/Users/me/Desktop/proj-a",
    });

    expect(capsule.memories.map((memory) => memory.id)).toEqual(["observed-deploy"]);
    expect(capsule.confidence).toBe("high");

    storage.close();
  });
});
