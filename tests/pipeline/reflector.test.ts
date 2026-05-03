import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, MemorySearchResult } from "../../src/types";

const llmGenerateJSONMock = mock(async (_prompt: string): Promise<unknown> => []);
const hasEmbeddingProviderMock = mock(() => true);
const embedTextsMock = mock(async (input: string[]) => input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })));

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: ["memory"],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date("2026-04-21T01:02:03.000Z").toISOString(),
    updatedAt: new Date("2026-04-21T01:02:03.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.7,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

function hit(memory: Memory): MemorySearchResult {
  return {
    memory,
    score: 0.88,
    reasons: ["semantic"],
  };
}

beforeEach(() => {
  llmGenerateJSONMock.mockClear();
  hasEmbeddingProviderMock.mockClear();
  embedTextsMock.mockClear();
  hasEmbeddingProviderMock.mockImplementation(() => true);
  embedTextsMock.mockImplementation(async (input: string[]) =>
    input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })),
  );

  mock.module("../../src/llm", () => ({
    llmGenerateJSON: llmGenerateJSONMock,
  }));
  mock.module("../../src/embeddings", () => ({
    hasEmbeddingProvider: hasEmbeddingProviderMock,
    embedTexts: embedTextsMock,
  }));
});

afterAll(() => {
  mock.restore();
});

function vectorOf(text: string): number[] {
  const normalized = text.toLowerCase();
  if (normalized.includes("known auth insight")) return [1, 0, 0];
  if (normalized.includes("refresh token and jwt rotation should stay consistent")) return [0.99, 0.05, 0];
  if (normalized.includes("fallback insight")) return [0.2, 1, 0];
  if (normalized.includes("auth insight")) return [0.95, 0.2, 0];
  return [0.1, 0.1, 0.98];
}

describe("reflect", () => {
  it("uses semantic related-memory retrieval for historical context", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        title: "Auth insight",
        summary: "JWT refresh and rotation should be linked.",
        details: "Capture the relationship for future debugging and audits.",
        tags: ["auth", "jwt"],
        salience: 0.82,
        linked_ids: [],
      },
    ]);

    const findRelatedMemoriesBatch = mock(async () => [[hit(makeMemory("ctx-1", { layer: "insight" }))], []]);
    const storage = {
      config: {} as never,
      listByLayer: (layer: "insight" | "semantic") =>
        layer === "insight" ? [makeMemory("old-insight", { layer: "insight" })] : [makeMemory("old-sem", { layer: "semantic" })],
      findRelatedMemoriesBatch,
    } as never;

    const { reflect } = await import("../../src/pipeline/reflector");
    const results = await reflect([makeMemory("m1"), makeMemory("m2")], storage);

    expect(findRelatedMemoriesBatch).toHaveBeenCalledTimes(1);
    expect(findRelatedMemoriesBatch).toHaveBeenCalledWith(expect.any(Array), {
      limit: 8,
      layers: ["insight", "semantic"],
    });
    expect(llmGenerateJSONMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(results)).toBe(true);
  });

  it("falls back to time-window context when semantic retrieval fails", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        title: "Fallback insight",
        summary: "Fallback context still allows insight extraction.",
        details: "Use listByLayer context when semantic retrieval throws.",
        tags: ["fallback"],
        salience: 0.7,
        linked_ids: [],
      },
    ]);

    const findRelatedMemoriesBatch = mock(async () => {
      throw new Error("vector backend unavailable");
    });
    const storage = {
      config: {} as never,
      listByLayer: (layer: "insight" | "semantic") =>
        layer === "insight" ? [makeMemory("old-insight", { layer: "insight" })] : [makeMemory("old-sem", { layer: "semantic" })],
      findRelatedMemoriesBatch,
    } as never;

    const { reflect } = await import("../../src/pipeline/reflector");
    const results = await reflect([makeMemory("m1"), makeMemory("m2")], storage);

    expect(findRelatedMemoriesBatch).toHaveBeenCalledTimes(1);
    expect(llmGenerateJSONMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(results)).toBe(true);
  });

  it("drops duplicate insights when semantic similarity passes the threshold", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        title: "Known auth insight",
        summary: "Refresh token and JWT rotation should stay consistent.",
        details: "Duplicate of an existing durable insight.",
        tags: ["auth"],
        salience: 0.8,
        linked_ids: [],
      },
    ]);
    const storage = {
      config: {} as never,
      listByLayer: (layer: "insight" | "semantic") =>
        layer === "insight"
          ? [makeMemory("existing-insight", { layer: "insight", title: "Known auth insight" })]
          : [makeMemory("ctx-sem", { layer: "semantic" })],
      findRelatedMemoriesBatch: mock(async () => [[]]),
    } as never;

    const { reflect } = await import("../../src/pipeline/reflector");
    const results = await reflect([makeMemory("m1"), makeMemory("m2")], storage);

    expect(results).toHaveLength(0);
  });
});
