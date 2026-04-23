import type { Memory } from "../types";
import { nanoid } from "nanoid";
import { llmGenerateJSON } from "../llm";
import { reflectPrompt } from "../llm/prompts";
import { RawInsightSchema } from "../llm/schemas";
import { textSimilarity } from "./normalizer";
import type { Storage } from "../storage";

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
  const recentSemantic = storage.listByLayer("semantic", 5);
  const context = [...recentInsights, ...recentSemantic].filter(
    (memory) => !memories.some((current) => current.id === memory.id),
  );

  const insights = await llmGenerateJSON(reflectPrompt(memories, context), RawInsightSchema);
  if (!Array.isArray(insights) || insights.length === 0) {
    return [];
  }

  const anchor = memories[0]!;
  const results: Memory[] = [];

  for (const insight of insights) {
    const isDuplicate = recentInsights.some((existing) => matchesExistingInsight(existing, insight));
    if (isDuplicate) continue;

    const isDuplicateInBatch = results.some((prev) => matchesExistingInsight(prev, insight));
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
      status: "observed" as const,
      sourceSessionIds: [anchor.sourceSessionId],
      supportingMemoryIds: memories.map((memory) => memory.id),
      salience: Math.max(0, Math.min(1, insight.salience)),
      linkedMemoryIds: Array.from(new Set(insight.linked_ids)),
      contradicts: [],
    });
  }

  return results;
}

function matchesExistingInsight(
  existing: Pick<Memory, "title" | "summary">,
  candidate: Pick<RawInsight, "title" | "summary">,
) {
  const titleSimilarity = textSimilarity(existing.title, candidate.title);
  const summarySimilarity = textSimilarity(existing.summary, candidate.summary);
  const combinedSimilarity = textSimilarity(
    [existing.title, existing.summary].join(" "),
    [candidate.title, candidate.summary].join(" "),
  );

  return Math.max(titleSimilarity, summarySimilarity, combinedSimilarity) > 0.4;
}
