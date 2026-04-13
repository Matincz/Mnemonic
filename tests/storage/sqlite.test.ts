// tests/storage/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MemoryDB } from "../../src/storage/sqlite";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import type { Memory } from "../../src/types";

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
});
