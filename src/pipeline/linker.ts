import type { Memory } from "../types";
import { llmGenerateJSON } from "../llm";
import { linkBatchPrompt, linkPrompt } from "../llm/prompts";
import { BatchLinkResultSchema, LinkResultSchema } from "../llm/schemas";
import type { Storage } from "../storage";

interface LinkResult {
  linked_ids: string[];
  contradicts_ids: string[];
  explanation: string;
}

interface BatchLinkResult extends LinkResult {
  memory_id: string;
}

export async function link(memory: Memory, storage: Storage): Promise<Memory> {
  const [linked] = await linkBatch([memory], storage);
  return linked ?? memory;
}

export async function linkBatch(memories: Memory[], storage: Storage): Promise<Memory[]> {
  if (memories.length === 0) {
    return [];
  }

  const related = await storage.findRelatedMemoriesBatch(memories, { limit: 8 });
  const items = memories
    .map((memory, index) => ({
      memory,
      candidates: (related[index] ?? []).map((result) => result.memory),
    }))
    .filter((item) => item.candidates.length > 0);

  if (items.length === 0) {
    return memories;
  }

  const results = await llmGenerateJSON(linkBatchPrompt(items), BatchLinkResultSchema);
  const resultMap = new Map(results.map((result) => [result.memory_id, result]));

  return memories.map((memory) => {
    const batchResult = resultMap.get(memory.id);
    if (!batchResult) {
      return memory;
    }

    const candidates = items.find((item) => item.memory.id === memory.id)?.candidates ?? [];
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const linkedIds = batchResult.linked_ids ?? [];
    const contradictsIds = batchResult.contradicts_ids ?? [];

    return {
      ...memory,
      linkedMemoryIds: linkedIds.filter((id) => candidateIds.has(id)),
      contradicts: contradictsIds.filter((id) => candidateIds.has(id)),
    };
  });
}

export async function linkWithPrompt(memory: Memory, storage: Storage): Promise<Memory> {
  const candidates = (await storage.findRelatedMemories(memory, { limit: 8 })).map((result) => result.memory);

  if (candidates.length === 0) return memory;

  const result = await llmGenerateJSON(linkPrompt(memory, candidates.slice(0, 10)), LinkResultSchema);
  const linkedIds = result.linked_ids ?? [];
  const contradictsIds = result.contradicts_ids ?? [];

  return {
    ...memory,
    linkedMemoryIds: linkedIds.filter((id) => candidates.some((candidate) => candidate.id === id)),
    contradicts: contradictsIds.filter((id) => candidates.some((candidate) => candidate.id === id)),
  };
}
