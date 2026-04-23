import { describe, expect, it } from "bun:test";
import { normalize, textSimilarity } from "../../src/pipeline/normalizer";
import type { Memory } from "../../src/types";

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: "Memory " + id,
    summary: "Summary of memory " + id + " describing a meaningful engineering fact worth retaining",
    details: "Detailed description of memory " + id + " with enough content to pass filters",
    tags: ["test"],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.7,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

describe("normalizer", () => {
  it("filters out memories with empty details", () => {
    const result = normalize([
      makeMemory("1", { details: "" }),
      makeMemory("2", { details: "   " }),
      makeMemory("3", { details: "Valid details with sufficient content" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("3");
  });

  it("filters out memories where summary and details are nearly identical", () => {
    const result = normalize([
      makeMemory("1", {
        summary: "Use bun test to run the full test suite in the project environment",
        details: "Use bun test to run the full test suite in the project environment",
      }),
      makeMemory("2", {
        summary: "Use bun test to run the full test suite with coverage reporting enabled",
        details: "Use bun test to run the full test suite with coverage enabled. Run from project root. Produces tap output and coverage report in .coverage/ directory.",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("merges near-duplicate titles keeping the richer one", () => {
    const result = normalize([
      makeMemory("1", { title: "Auth token rotation", details: "Rotate the auth tokens periodically for compliance" }),
      makeMemory("2", {
        title: "Auth token rotation procedure",
        details: "Detailed guide to rotating auth tokens in production environments with full rollback and audit steps",
        tags: ["auth", "security"],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.details).toContain("Detailed guide");
    expect(result[0]!.tags).toContain("auth");
    expect(result[0]!.tags).toContain("security");
  });

  it("downgrades weak semantic/procedural to episodic", () => {
    const result = normalize([
      makeMemory("1", {
        layer: "semantic",
        salience: 0.3,
        title: "Transient version check observation",
        summary: "Checked the installed codex version number during an upgrade request workflow",
        details: "Identified current codex version as 0.116.0 during routine update",
      }),
      makeMemory("2", {
        layer: "procedural",
        salience: 0.8,
        title: "Auth token rotation procedure",
        summary: "Complete step-by-step procedure for rotating authentication tokens in production",
        details: "Comprehensive procedural memory with lots of detail to exceed threshold",
      }),
    ]);

    expect(result.find((memory) => memory.id === "1")?.layer).toBe("episodic");
    expect(result.find((memory) => memory.id === "2")?.layer).toBe("procedural");
  });

  it("preserves good memories unchanged", () => {
    const good = makeMemory("1", {
      layer: "semantic",
      salience: 0.9,
      details: "This is a comprehensive and detailed description of an important concept that should be preserved",
    });

    const result = normalize([good]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(good);
  });
});

describe("textSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(textSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(textSimilarity("hello world", "foo bar baz")).toBe(0);
  });

  it("returns value between 0 and 1 for partial overlap", () => {
    const similarity = textSimilarity("hello world foo", "hello world bar");
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });
});
