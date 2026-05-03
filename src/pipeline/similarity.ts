import type { Storage } from "../storage";
import { embedTexts, hasEmbeddingProvider } from "../embeddings";
import { textSimilarity } from "./normalizer";

const MAX_VECTOR_CACHE_SIZE = 200;

const vectorCache = new Map<string, number[]>();

export interface SemanticSimilarityOptions {
  storage?: Pick<Storage, "config">;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function semanticSimilarity(
  textA: string,
  textB: string,
  options: SemanticSimilarityOptions = {},
): Promise<number> {
  const [score] = await batchPairwiseSimilarity([[textA, textB]], options);
  return score ?? 0;
}

export async function batchPairwiseSimilarity(
  pairs: Array<[string, string]>,
  options: SemanticSimilarityOptions = {},
): Promise<number[]> {
  if (pairs.length === 0) {
    return [];
  }

  if (!hasEmbeddingProvider(undefined, options.storage?.config)) {
    return pairs.map(([left, right]) => textSimilarity(left, right));
  }

  const normalizedPairs = pairs.map(([left, right]) => [normalizeText(left), normalizeText(right)] as const);
  const missing = new Set<string>();
  for (const [left, right] of normalizedPairs) {
    if (left && !vectorCache.has(left)) missing.add(left);
    if (right && !vectorCache.has(right)) missing.add(right);
  }

  try {
    if (missing.size > 0) {
      const missingTexts = [...missing];
      const vectors = await embedTexts(missingTexts, {
        config: options.storage?.config,
      });
      for (let i = 0; i < missingTexts.length; i += 1) {
        const text = missingTexts[i];
        const vector = vectors[i]?.values;
        if (text && vector) {
          cacheVector(text, vector);
        }
      }
    }
  } catch {
    return pairs.map(([left, right]) => textSimilarity(left, right));
  }

  return normalizedPairs.map(([left, right], index) => {
    const leftVector = left ? getCachedVector(left) : null;
    const rightVector = right ? getCachedVector(right) : null;
    if (!leftVector || !rightVector) {
      return textSimilarity(pairs[index]?.[0] ?? "", pairs[index]?.[1] ?? "");
    }
    return cosineSimilarity(leftVector, rightVector);
  });
}

export function resetSimilarityVectorCacheForTests() {
  vectorCache.clear();
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cacheVector(text: string, vector: number[]) {
  if (vectorCache.has(text)) {
    vectorCache.delete(text);
  }
  vectorCache.set(text, vector);

  while (vectorCache.size > MAX_VECTOR_CACHE_SIZE) {
    const oldestKey = vectorCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    vectorCache.delete(oldestKey);
  }
}

function getCachedVector(text: string): number[] | null {
  const vector = vectorCache.get(text);
  if (!vector) {
    return null;
  }

  // Refresh recency on access.
  vectorCache.delete(text);
  vectorCache.set(text, vector);
  return vector;
}
