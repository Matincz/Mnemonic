import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Memory } from "../../src/types";
import { deduplicateExactTitleGroups, deduplicateMemoryCorpus } from "../../src/storage/deduplicate";

const hasEmbeddingProviderMock = mock(() => false);
const embedTextsMock = mock(async (input: string[]) => input.map((text) => ({ model: "test", values: vectorOf(text) })));

mock.module("../../src/embeddings", () => ({
  hasEmbeddingProvider: hasEmbeddingProviderMock,
  embedTexts: embedTextsMock,
  invalidateEmbeddingCache: mock(() => {}),
}));
mock.module("../../src/embeddings/index", () => ({
  hasEmbeddingProvider: hasEmbeddingProviderMock,
  embedTexts: embedTextsMock,
  invalidateEmbeddingCache: mock(() => {}),
}));

afterEach(() => {
  hasEmbeddingProviderMock.mockImplementation(() => false);
  embedTextsMock.mockClear();
  delete process.env.MNEMONIC_SIMILARITY_FORCE_FALLBACK;
});

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
  it("merges near-duplicate titles across batches when summaries and tags align", async () => {
    const result = await deduplicateMemoryCorpus([
      makeMemory("mem-1", {
        title: "Tire Pressure Variance Observation",
        summary:
          "Routine telemetry showed slight tire pressure variance during monitoring and no corrective action was required.",
        tags: ["telemetry", "tire"],
      }),
      makeMemory("mem-2", {
        title: "Tire Pressure Variation Observation",
        summary:
          "Routine telemetry showed slight tire pressure variation during monitoring and no corrective action was required.",
        details: "Longer details with the same durable takeaway, richer examples, and additional baseline data.",
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

  it("merges title-containment duplicates while preserving the project guard", async () => {
    const result = await deduplicateMemoryCorpus([
      makeMemory("mem-1", {
        title: "Telegram architecture",
        summary: "Telegram delivery should use the same proxy routing and webhook lifecycle.",
        tags: ["telegram", "architecture"],
        project: "mnemonic",
      }),
      makeMemory("mem-2", {
        title: "Telegram architecture and health checks",
        summary: "Telegram delivery should use the same proxy routing plus health check lifecycle.",
        details: "Richer Telegram architecture details covering proxy routing, webhook lifecycle, and health checks.",
        tags: ["telegram", "architecture", "health"],
        sourceSessionIds: ["session-2"],
        project: "mnemonic",
      }),
      makeMemory("mem-3", {
        title: "Telegram architecture and health checks",
        summary: "Another project uses Telegram architecture language for a different implementation.",
        tags: ["telegram", "architecture"],
        sourceSessionIds: ["session-3"],
        project: "other-project",
      }),
    ]);

    expect(result.report.removed).toBe(1);
    expect(result.memories).toHaveLength(2);
    expect(result.memories.find((memory) => memory.id === "mem-2")?.sourceSessionIds).toEqual([
      "session-1",
      "session-2",
    ]);
    expect(result.memories.find((memory) => memory.project === "other-project")).toBeDefined();
  });

  it("uses semantic similarity for coarse candidates and falls back to lexical matching", async () => {
    hasEmbeddingProviderMock.mockImplementation(() => true);

    const result = await deduplicateMemoryCorpus(
      [
        makeMemory("mem-1", {
          title: "OAuth refresh token rotation",
          summary: "Refresh token rotation must persist the updated credential pair after renewal.",
          details: "The durable lesson is to persist both access and refresh credentials after renewal succeeds.",
          tags: ["auth"],
        }),
        makeMemory("mem-2", {
          title: "Credential renewal persistence",
          summary: "After OAuth renewal, the updated token pair must be saved atomically.",
          details: "Same durable lesson stated with different wording; persist the renewed credential pair together.",
          tags: ["auth"],
          sourceSessionIds: ["session-2"],
        }),
      ],
      { storage: { config: {} as never } },
    );

    expect(embedTextsMock).toHaveBeenCalled();
    expect(result.report.removed).toBe(1);
  });
});

function vectorOf(text: string): number[] {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("oauth refresh token rotation") ||
    normalized.includes("credential renewal persistence") ||
    normalized.includes("updated credential pair") ||
    normalized.includes("updated token pair")
  ) {
    return [1, 0, 0];
  }
  return [0, 1, 0];
}
