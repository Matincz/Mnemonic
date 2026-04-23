import { describe, expect, it } from "bun:test";
import type { Memory } from "../../src/types";
import { deduplicateExactTitleGroups, deduplicateMemoryCorpus } from "../../src/storage/deduplicate";

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: "CCB Protocol Strictness",
    summary: "Strict protocol handling is required.",
    details: "Protocol handling is strict and rejects malformed markers.",
    tags: ["ccb"],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.6,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

describe("deduplicateExactTitleGroups", () => {
  it("merges exact-title duplicates and keeps the richest canonical version", () => {
    const result = deduplicateExactTitleGroups([
      makeMemory("mem-1", {
        summary: "Short summary",
        details: "Short details",
        sourceSessionIds: ["session-1"],
        supportingMemoryIds: ["support-1", "support-2"],
      }),
      makeMemory("mem-2", {
        title: "  CCB Protocol Strictness  ",
        details: "Longer details with more durable context and examples.",
        tags: ["ccb", "protocol"],
        sourceSessionIds: ["session-2"],
        linkedMemoryIds: ["mem-x"],
        salience: 0.9,
        status: "verified",
        updatedAt: new Date("2026-04-21T00:00:00.000Z").toISOString(),
      }),
      makeMemory("mem-3", {
        title: "Different Topic",
      }),
    ]);

    expect(result.report.removed).toBe(1);
    expect(result.report.mergedGroups).toBe(1);
    expect(result.memories).toHaveLength(2);

    const merged = result.memories.find((memory) => memory.id === "mem-1");
    expect(merged).toBeDefined();
    expect(merged?.details).toContain("durable context");
    expect(merged?.tags).toEqual(["ccb", "protocol"]);
    expect(merged?.sourceSessionIds).toEqual(["session-1", "session-2"]);
    expect(merged?.supportingMemoryIds).toEqual(["support-1", "support-2"]);
    expect(merged?.linkedMemoryIds).toEqual(["mem-x"]);
    expect(merged?.salience).toBe(0.9);
    expect(merged?.status).toBe("verified");
  });
});

describe("deduplicateMemoryCorpus", () => {
  it("merges near-duplicate titles across batches when summaries and tags align", () => {
    const result = deduplicateMemoryCorpus([
      makeMemory("mem-1", {
        title: "Tire Pressure Variance Observation",
        summary: "Routine telemetry showed slight tire pressure variance during monitoring.",
        tags: ["telemetry", "tire"],
      }),
      makeMemory("mem-2", {
        title: "Tire Pressure Variation Observation",
        summary: "Routine telemetry showed slight tire pressure variation during monitoring.",
        details: "Longer details with the same durable takeaway and richer examples.",
        tags: ["tire", "telemetry", "sensor"],
        sourceSessionIds: ["session-2"],
        status: "verified",
      }),
      makeMemory("mem-3", {
        title: "Completely Different Topic",
      }),
    ]);

    expect(result.report.removed).toBe(1);
    expect(result.report.mergedGroups).toBe(1);
    expect(result.memories).toHaveLength(2);

    const merged = result.memories.find((memory) => memory.id === "mem-2");
    expect(merged).toBeDefined();
    expect(merged?.tags).toEqual(["telemetry", "tire", "sensor"]);
    expect(merged?.status).toBe("verified");
  });
});
