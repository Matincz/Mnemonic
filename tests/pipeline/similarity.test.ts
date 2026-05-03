import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { textSimilarity } from "../../src/pipeline/normalizer";

const hasEmbeddingProviderMock = mock(() => true);
const embedTextsMock = mock(async (input: string[]) => input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })));

function vectorOf(text: string): number[] {
  const normalized = text.toLowerCase();
  if (normalized.includes("auth refresh")) return [1, 0, 0];
  if (normalized.includes("jwt refresh")) return [0.98, 0.1, 0];
  if (normalized.includes("database migration")) return [0, 1, 0];
  return [0.2, 0.2, 0.9];
}

beforeEach(async () => {
  hasEmbeddingProviderMock.mockClear();
  embedTextsMock.mockClear();
  hasEmbeddingProviderMock.mockImplementation(() => true);
  embedTextsMock.mockImplementation(async (input: string[]) =>
    input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })),
  );

  mock.module("../../src/embeddings", () => ({
    hasEmbeddingProvider: hasEmbeddingProviderMock,
    embedTexts: embedTextsMock,
  }));

  const { resetSimilarityVectorCacheForTests } = await import("../../src/pipeline/similarity");
  resetSimilarityVectorCacheForTests();
});

afterAll(() => {
  mock.restore();
});

describe("similarity utilities", () => {
  it("computes cosine similarity correctly", async () => {
    const { cosineSimilarity } = await import("../../src/pipeline/similarity");
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.sqrt(2) / 2, 5);
  });

  it("falls back to text similarity when embedding is unavailable", async () => {
    hasEmbeddingProviderMock.mockImplementation(() => false);

    const { semanticSimilarity } = await import("../../src/pipeline/similarity");
    const left = "auth refresh token flow";
    const right = "refresh token flow for auth";
    const score = await semanticSimilarity(left, right);

    expect(score).toBe(textSimilarity(left, right));
    expect(embedTextsMock).not.toHaveBeenCalled();
  });

  it("reuses cached vectors for repeated comparisons", async () => {
    const { semanticSimilarity } = await import("../../src/pipeline/similarity");
    const left = "Auth refresh token flow";
    const right = "JWT refresh handling";

    const first = await semanticSimilarity(left, right);
    const second = await semanticSimilarity(left, right);

    expect(first).toBeGreaterThan(0.9);
    expect(second).toBeCloseTo(first, 6);
    expect(embedTextsMock).toHaveBeenCalledTimes(1);
  });
});
