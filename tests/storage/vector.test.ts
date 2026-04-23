import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MemoryDB } from "../../src/storage/sqlite";
import { createVectorStore, type VectorStore } from "../../src/storage/vector";
import type { Memory } from "../../src/types";

const TEST_DB = join(import.meta.dir, "test-vector.db");
const TEST_LANCE_DIR = join(tmpdir(), "mnemonic-test-lance");

describe("VectorStore", () => {
  let db: MemoryDB;

  const makeMemory = (overrides: Partial<Memory> = {}): Memory => ({
    id: "mem-1",
    layer: "episodic",
    title: "Fixed auth bug",
    summary: "Fixed JWT refresh token rotation",
    details: "Updated middleware to rotate refresh tokens",
    tags: ["auth", "jwt"],
    project: "my-app",
    sourceSessionId: "codex-abc123",
    sourceAgent: "codex",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "observed",
    sourceSessionIds: ["codex-abc123"],
    supportingMemoryIds: [],
    salience: 0.8,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  });

  beforeEach(() => {
    db = new MemoryDB(TEST_DB);
    rmSync(TEST_LANCE_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = TEST_DB + suffix;
      if (existsSync(file)) unlinkSync(file);
    }
    rmSync(TEST_LANCE_DIR, { recursive: true, force: true });
  });

  async function withVectorStore(
    backend: "sqlite" | "lancedb",
    run: (vectorStore: VectorStore) => Promise<void>,
  ) {
    const vectorStore = createVectorStore({
      backend,
      dbPath: TEST_DB,
      lanceDir: TEST_LANCE_DIR,
    });
    await vectorStore.init();
    try {
      await run(vectorStore);
    } finally {
      vectorStore.close();
    }
  }

  it("searches memories by embedding similarity with sqlite backend", async () => {
    await withVectorStore("sqlite", async (vectorStore) => {
      const mem1 = makeMemory({ id: "mem-1", title: "Auth refresh flow" });
      const mem2 = makeMemory({ id: "mem-2", title: "Database migration" });
      db.upsertMemory(mem1);
      db.upsertMemory(mem2);
      await vectorStore.upsert(mem1, [1, 0, 0], "test-model");
      await vectorStore.upsert(mem2, [0, 1, 0], "test-model");

      const results = await vectorStore.search([0.9, 0.1, 0], 2);
      expect(results).toHaveLength(2);
      expect(results[0]!.memory.id).toBe("mem-1");
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);

      const status = await vectorStore.status();
      expect(status.backend).toBe("sqlite");
      expect(status.indexed).toBe(2);
    });
  });

  it("returns candidate ids using memory filters with sqlite backend", async () => {
    await withVectorStore("sqlite", async (vectorStore) => {
      db.upsertMemory(makeMemory({ id: "mem-1", project: "a", layer: "semantic" }));
      db.upsertMemory(makeMemory({ id: "mem-2", project: "b", layer: "insight" }));
      db.upsertMemory(makeMemory({ id: "mem-3", project: "a", layer: "insight" }));

      const candidates = await vectorStore.listCandidateIds(10, {
        project: "a",
        layers: ["insight", "semantic"],
        excludeIds: ["mem-1"],
      });

      expect(candidates).toEqual(["mem-3"]);
    });
  });

  it("searches memories by embedding similarity with lancedb backend", async () => {
    await withVectorStore("lancedb", async (vectorStore) => {
      const mem1 = makeMemory({ id: "mem-1", title: "Auth refresh flow" });
      const mem2 = makeMemory({ id: "mem-2", title: "Database migration" });
      await vectorStore.upsert(mem1, [1, 0, 0], "test-model");
      await vectorStore.upsert(mem2, [0, 1, 0], "test-model");

      const results = await vectorStore.search([0.9, 0.1, 0], 2);
      expect(results).toHaveLength(2);
      expect(results[0]!.memory.id).toBe("mem-1");

      const optimize = await vectorStore.optimize();
      expect(optimize.backend).toBe("lancedb");
      expect(optimize.optimized).toBe(true);

      const status = await vectorStore.status();
      expect(status.backend).toBe("lancedb");
      expect(status.indexed).toBe(2);
    });
  });

  it("does not fail LanceDB indexing before PQ has enough rows", async () => {
    await withVectorStore("lancedb", async (vectorStore) => {
      for (let index = 0; index < 90; index += 1) {
        const memory = makeMemory({
          id: `mem-${index}`,
          title: `Memory ${index}`,
          summary: `Summary ${index}`,
          details: `Details ${index}`,
        });

        await vectorStore.upsert(
          memory,
          [index + 1, index + 2, index + 3],
          "test-model",
        );
      }

      const status = await vectorStore.status();
      expect(status.backend).toBe("lancedb");
      expect(status.indexed).toBe(90);
      expect(status.indices.some((index) => index.name === "vector_idx")).toBe(false);
    });
  });
});
