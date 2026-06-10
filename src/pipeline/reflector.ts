import type { Memory } from "../types";
import { nanoid } from "nanoid";
import { llmGenerateJSON } from "../llm";
import { reflectPrompt } from "../llm/prompts";
import { RawInsightSchema } from "../llm/schemas";
import { semanticSimilarity } from "./similarity";
import type { Storage } from "../storage";
import { MIN_INSIGHT_SALIENCE } from "./normalizer";

interface RawInsight {
  title: string;
  summary: string;
  details: string;
  tags: string[];
  salience: number;
  linked_ids: string[];
}

export async function reflect(memories: Memory[], storage: Storage): Promise<Memory[]> {
  if (memories.length < 2) {
    return [];
  }

  const recentInsights = storage.listByLayer("insight", 20);
  const fallbackContext = [...recentInsights, ...storage.listByLayer("semantic", 5)].filter(
    (memory) => !memories.some((current) => current.id === memory.id),
  );
  const context = await buildReflectionContext(memories, storage, fallbackContext);

  const insights = await llmGenerateJSON(reflectPrompt(memories, context), RawInsightSchema, {
    component: "reflector",
    schemaName: "RawInsightSchema",
  });
  if (!Array.isArray(insights) || insights.length === 0) {
    return [];
  }

  const anchor = memories[0]!;
  const results: Memory[] = [];

  for (const insight of insights) {
    if (insight.salience < MIN_INSIGHT_SALIENCE) {
      continue;
    }

    const isDuplicate = await hasInsightDuplicate(recentInsights, insight, storage);
    if (isDuplicate) continue;

    const isDuplicateInBatch = await hasInsightDuplicate(results, insight, storage);
    if (isDuplicateInBatch) continue;

    const timestamp = anchor.createdAt;
    results.push({
      id: `mem-${nanoid(12)}`,
      layer: "insight",
      title: insight.title,
      summary: insight.summary,
      details: insight.details,
      tags: Array.from(new Set(insight.tags)),
      project: anchor.project,
      sourceSessionId: anchor.sourceSessionId,
      sourceAgent: anchor.sourceAgent,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "proposed" as const,
      sourceSessionIds: [anchor.sourceSessionId],
      supportingMemoryIds: memories.map((memory) => memory.id),
      salience: Math.max(0, Math.min(1, insight.salience)),
      linkedMemoryIds: Array.from(new Set(insight.linked_ids)),
      contradicts: [],
    });
  }

  return results;
}

async function hasInsightDuplicate(
  existingInsights: Array<Pick<Memory, "title" | "summary">>,
  candidate: Pick<RawInsight, "title" | "summary">,
  storage: Pick<Storage, "config">,
) {
  for (const existing of existingInsights) {
    if (await matchesExistingInsight(existing, candidate, storage)) {
      return true;
    }
  }
  return false;
}

async function matchesExistingInsight(
  existing: Pick<Memory, "title" | "summary">,
  candidate: Pick<RawInsight, "title" | "summary">,
  storage: Pick<Storage, "config">,
) {
  const titleSimilarity = await semanticSimilarity(existing.title, candidate.title, { storage });
  const summarySimilarity = await semanticSimilarity(existing.summary, candidate.summary, { storage });
  const combinedSimilarity = await semanticSimilarity(
    [existing.title, existing.summary].join(" "),
    [candidate.title, candidate.summary].join(" "),
    { storage },
  );

  return Math.max(titleSimilarity, summarySimilarity, combinedSimilarity) >= 0.6;
}

async function buildReflectionContext(memories: Memory[], storage: Storage, fallbackContext: Memory[]) {
  try {
    const related = await storage.findRelatedMemoriesBatch(memories, {
      limit: 8,
      layers: ["insight", "semantic"],
    });
    const contextMap = new Map<string, Memory>();
    for (const hits of related) {
      for (const hit of hits) {
        const memory = hit.memory;
        if (memories.some((current) => current.id === memory.id)) {
          continue;
        }
        contextMap.set(memory.id, memory);
      }
    }
    const context = [...contextMap.values()].slice(0, 25);
    return context.length > 0 ? context : fallbackContext;
  } catch {
    return fallbackContext;
  }
}
