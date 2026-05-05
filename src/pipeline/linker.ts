import type { Memory } from "../types";
import { llmGenerateJSON } from "../llm";
import { linkBatchPrompt, linkPrompt } from "../llm/prompts";
import { BatchLinkResultSchema, LinkResultSchema } from "../llm/schemas";
import type { Storage } from "../storage";

const HEURISTIC_CONTRADICTION_THRESHOLD = 0.85;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CONTRADICTION_CUES = /\b(?:not|never|remove|removed|removing|instead of|replace|replaced|replacing|disable|disabled|without)\b/i;

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
      hits: related[index] ?? [],
      candidates: (related[index] ?? []).map((result) => result.memory),
    }))
    .filter((item) => item.candidates.length > 0);

  if (items.length === 0) {
    return memories;
  }

  const results = await llmGenerateJSON(linkBatchPrompt(items), BatchLinkResultSchema);
  const resultMap = new Map(results.map((result) => [result.memory_id, result]));
  const supersededUpdates = new Map<string, Memory>();

  const linkedMemories = memories.map((memory) => {
    const batchResult = resultMap.get(memory.id);
    const item = items.find((entry) => entry.memory.id === memory.id);
    if (!item) {
      return memory;
    }

    const candidates = item.candidates;
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const candidateScores = new Map(item.hits.map((hit) => [hit.memory.id, hit.score]));
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const linkedIds = batchResult?.linked_ids ?? [];
    const heuristicContradictIds = candidates
      .filter((candidate) => heuristicContradicts(memory, candidate, candidateScores.get(candidate.id) ?? 0))
      .map((candidate) => candidate.id);
    const contradictsIds = [...(batchResult?.contradicts_ids ?? []), ...heuristicContradictIds];
    const validContradicts = Array.from(new Set(contradictsIds.filter((id) => candidateIds.has(id))));

    if (!batchResult && validContradicts.length === 0) {
      return memory;
    }

    for (const contradictId of validContradicts) {
      const candidate = candidateMap.get(contradictId);
      if (!candidate) {
        continue;
      }

      if (!shouldSupersedeCandidate(memory, candidate)) {
        continue;
      }

      const previous = supersededUpdates.get(candidate.id) ?? candidate;
      supersededUpdates.set(candidate.id, {
        ...previous,
        status: "superseded",
        updatedAt: memory.createdAt,
        salience: Math.max(0, Math.min(1, previous.salience * 0.7)),
        linkedMemoryIds: Array.from(new Set([...(previous.linkedMemoryIds ?? []), memory.id])),
      });
    }

    return {
      ...memory,
      linkedMemoryIds: linkedIds.filter((id) => candidateIds.has(id)),
      contradicts: validContradicts,
    };
  });

  if (supersededUpdates.size > 0) {
    const saveMemories = (storage as Partial<Pick<Storage, "saveMemories">>).saveMemories;
    if (typeof saveMemories === "function") {
      await saveMemories.call(storage, [...supersededUpdates.values()]);
    }
  }

  return linkedMemories;
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

function shouldSupersedeCandidate(incoming: Memory, candidate: Memory) {
  const incomingCreatedAt = new Date(incoming.createdAt).getTime();
  const candidateCreatedAt = new Date(candidate.createdAt).getTime();

  if (!Number.isFinite(incomingCreatedAt) || !Number.isFinite(candidateCreatedAt)) {
    return false;
  }

  return incomingCreatedAt > candidateCreatedAt + ONE_DAY_MS;
}

function heuristicContradicts(incoming: Memory, candidate: Memory, similarity: number): boolean {
  if (similarity < HEURISTIC_CONTRADICTION_THRESHOLD) {
    return false;
  }

  if (incoming.project !== candidate.project || incoming.layer !== candidate.layer) {
    return false;
  }

  const incomingText = memoryText(incoming);
  const candidateText = memoryText(candidate);
  const incomingCue = CONTRADICTION_CUES.test(incomingText);
  const candidateCue = CONTRADICTION_CUES.test(candidateText);
  if (incomingCue === candidateCue) {
    return false;
  }

  return sharesMeaningfulToken(incomingText, candidateText);
}

function memoryText(memory: Memory) {
  return [memory.title, memory.summary, memory.details].filter(Boolean).join("\n");
}

function sharesMeaningfulToken(left: string, right: string) {
  const stop = new Set(["the", "and", "for", "with", "this", "that", "should", "memory", "summary", "details"]);
  const rightTokens = new Set(tokenize(right).filter((token) => !stop.has(token) && token.length > 3));
  return tokenize(left).some((token) => rightTokens.has(token) && !stop.has(token) && token.length > 3);
}

function tokenize(text: string) {
  return text.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];
}
