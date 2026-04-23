// tests/storage/markdown.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MarkdownVault } from "../../src/storage/markdown";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import type { Memory } from "../../src/types";

const TEST_VAULT = join(import.meta.dir, "test-vault");

describe("MarkdownVault", () => {
  let vault: MarkdownVault;

  beforeEach(() => {
    vault = new MarkdownVault(TEST_VAULT);
  });

  afterEach(() => {
    if (existsSync(TEST_VAULT)) rmSync(TEST_VAULT, { recursive: true });
  });

  const makeMemory = (): Memory => ({
    id: "mem-test-1",
    layer: "episodic",
    title: "Fixed auth bug",
    summary: "Fixed JWT refresh token rotation in the auth middleware",
    details: "Updated the auth middleware to rotate refresh tokens on each use, preventing token replay attacks.",
    tags: ["auth", "jwt", "security"],
    project: "my-app",
    sourceSessionId: "codex-abc123",
    sourceAgent: "codex",
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    status: "observed",
    sourceSessionIds: ["codex-abc123"],
    supportingMemoryIds: [],
    salience: 0.85,
    linkedMemoryIds: ["mem-old-1"],
    contradicts: [],
  });

  it("writes a memory as markdown with frontmatter", () => {
    vault.writeMemory(makeMemory());
    const filePath = join(TEST_VAULT, "episodic", "mem-test-1.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("title: Fixed auth bug");
    expect(content).toContain("tags:");
    expect(content).toContain("- auth");
    expect(content).toContain("## Summary");
    expect(content).toContain("JWT refresh token");
  });

  it("creates index.md", () => {
    vault.writeMemory(makeMemory());
    vault.rebuildIndex([makeMemory()]);
    const indexPath = join(TEST_VAULT, "index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("Fixed auth bug");
  });
});
