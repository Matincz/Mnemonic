// tests/storage/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MemoryDB } from "../../src/storage/sqlite";
import { join } from "path";
import { unlinkSync, existsSync, mkdtempSync, rmSync } from "fs";
import type { Memory } from "../../src/types";
import { tmpdir } from "os";

const TEST_DB = join(import.meta.dir, "test-memory.db");

describe("MemoryDB", () => {
  let db: MemoryDB;

  beforeEach(() => {
    db = new MemoryDB(TEST_DB);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = TEST_DB + suffix;
      if (existsSync(f)) unlinkSync(f);
    }
  });

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

  it("inserts and retrieves a memory", () => {
    const mem = makeMemory();
    db.upsertMemory(mem);
    const result = db.getMemory("mem-1");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Fixed auth bug");
    expect(result!.tags).toEqual(["auth", "jwt"]);
  });

  it("searches memories by text", () => {
    db.upsertMemory(makeMemory({ id: "mem-1", title: "Auth fix" }));
    db.upsertMemory(makeMemory({ id: "mem-2", title: "DB migration", summary: "Migrated postgres" }));
    const results = db.searchMemories("auth");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("Auth fix");
  });

  it("tracks processed files", () => {
    db.markFileProcessed("/path/to/file", "hash123", "session-1");
    expect(db.isFileProcessed("/path/to/file", "hash123")).toBe(true);
    expect(db.isFileProcessed("/path/to/file", "hash456")).toBe(false);
  });

  it("lists memories by layer", () => {
    db.upsertMemory(makeMemory({ id: "m1", layer: "episodic" }));
    db.upsertMemory(makeMemory({ id: "m2", layer: "semantic" }));
    db.upsertMemory(makeMemory({ id: "m3", layer: "episodic" }));
    const episodic = db.listByLayer("episodic");
    expect(episodic).toHaveLength(2);
  });

  it("stores and loads pipeline checkpoints", () => {
    db.saveCheckpoint("session-1", "ingesting", [{ id: "mem-1" }]);
    expect(db.loadCheckpoint<Array<{ id: string }>>("session-1", "ingesting")).toEqual([{ id: "mem-1" }]);

    db.clearCheckpoints("session-1");
    expect(db.loadCheckpoint("session-1", "ingesting")).toBeNull();
  });

  it("rolls back failed transactions", () => {
    expect(() =>
      db.withTransaction(() => {
        db.upsertMemory(makeMemory({ id: "tx-1" }));
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(db.getMemory("tx-1")).toBeNull();
  });

  it("replaces memory rows without clearing processed files or checkpoints", () => {
    db.upsertMemory(makeMemory({ id: "old-1" }));
    db.markFileProcessed("/path/to/file", "hash123", "session-1");
    db.saveCheckpoint("session-1", "ingesting", [{ id: "old-1" }]);

    db.replaceAllMemories([
      makeMemory({
        id: "new-1",
        title: "Rebuilt memory set",
      }),
    ]);

    expect(db.getMemory("old-1")).toBeNull();
    expect(db.getMemory("new-1")?.title).toBe("Rebuilt memory set");
    expect(db.isFileProcessed("/path/to/file", "hash123")).toBe(true);
    expect(db.loadCheckpoint<Array<{ id: string }>>("session-1", "ingesting")).toEqual([{ id: "old-1" }]);
  });

  it("creates the database parent directory when missing", () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-sqlite-"));
    const nestedDbPath = join(root, "nested", "memory.db");

    const nestedDb = new MemoryDB(nestedDbPath);
    nestedDb.close();

    expect(existsSync(nestedDbPath)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

});
