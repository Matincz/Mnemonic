import { nanoid } from "nanoid";
import type { ParsedSession, Memory, MemorySearchResult } from "../types";
import { llmGenerateJSON } from "../llm";
import { ingestPrompt } from "../llm/prompts";
import { RawMemorySchema } from "../llm/schemas";
import type { Storage } from "../storage";
import { textSimilarity } from "./normalizer";
import { normalizeProjectName } from "./project";

const DEDUPLICATION_SIMILARITY_THRESHOLD = 0.7;
const HIGH_CONFIDENCE_TITLE_THRESHOLD = 0.9;

export async function ingest(
  session: ParsedSession,
  storage?: Pick<Storage, "findRelatedMemoriesBatch">,
): Promise<Memory[]> {
  const rawMemories = await llmGenerateJSON(ingestPrompt(session), RawMemorySchema);
  const project = normalizeProjectName(session.project);

  const extracted = rawMemories.map((raw) => {
    const timestamp = session.timestamp.toISOString();
    return {
      id: `mem-${nanoid(12)}`,
      layer: raw.layer,
      title: raw.title,
      summary: raw.summary,
      details: raw.details,
      tags: raw.tags,
      project,
      sourceSessionId: session.id,
      sourceAgent: session.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: (raw.status ?? "observed") as Memory["status"],
      sourceSessionIds: [session.id],
      supportingMemoryIds: [],
      salience: Math.max(0, Math.min(1, raw.salience)),
      linkedMemoryIds: [],
      contradicts: [],
    };
  });

  if (!storage || extracted.length === 0) {
    return extracted;
  }

  const relatedByMemory = await storage.findRelatedMemoriesBatch(extracted, { limit: 15 });
  return extracted.flatMap((memory, index) => {
    const duplicate = findDuplicateCandidate(memory, relatedByMemory[index] ?? []);
    if (!duplicate) {
      return [memory];
    }

    if (shouldUpdateExistingMemory(memory, duplicate)) {
      return [mergeIntoExistingMemory(memory, duplicate)];
    }

    return [];
  });
}

function findDuplicateCandidate(memory: Memory, candidates: MemorySearchResult[]) {
  let bestMatch: { candidate: Memory; score: number } | null = null;

  for (const { memory: candidate } of candidates) {
    if (candidate.layer !== memory.layer) {
      continue;
    }

    const titleSimilarity = textSimilarity(memory.title, candidate.title);
    const summarySimilarity = textSimilarity(memory.summary, candidate.summary);
    const combinedSimilarity = textSimilarity(
      [memory.title, memory.summary].join(" "),
      [candidate.title, candidate.summary].join(" "),
    );

    const score = Math.max(titleSimilarity, summarySimilarity, combinedSimilarity);
    const exactEnough = titleSimilarity >= HIGH_CONFIDENCE_TITLE_THRESHOLD;
    const similarEnough = hasTagOverlap(memory.tags, candidate.tags) && score >= DEDUPLICATION_SIMILARITY_THRESHOLD;
    if (!exactEnough && !similarEnough) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { candidate, score };
    }
  }

  return bestMatch?.candidate ?? null;
}

function shouldUpdateExistingMemory(incoming: Memory, existing: Memory) {
  if (statusPriority(incoming.status) > statusPriority(existing.status)) {
    return true;
  }

  if (incoming.salience > existing.salience + 0.15) {
    return true;
  }

  if (incoming.details.length > existing.details.length + 40) {
    return true;
  }

  return false;
}

function mergeIntoExistingMemory(incoming: Memory, existing: Memory): Memory {
  return {
    ...existing,
    summary: pickLongerText(existing.summary, incoming.summary),
    details: pickLongerText(existing.details, incoming.details),
    project: existing.project ?? incoming.project,
    sourceSessionId: incoming.sourceSessionId,
    sourceAgent: incoming.sourceAgent,
    updatedAt: incoming.updatedAt,
    status: statusPriority(incoming.status) > statusPriority(existing.status) ? incoming.status : existing.status,
    sourceSessionIds: Array.from(new Set([...(existing.sourceSessionIds ?? []), ...incoming.sourceSessionIds])),
    supportingMemoryIds: Array.from(new Set([...(existing.supportingMemoryIds ?? []), incoming.id])),
    salience: Math.max(existing.salience, incoming.salience),
    linkedMemoryIds: Array.from(new Set([...(existing.linkedMemoryIds ?? []), ...incoming.linkedMemoryIds])),
    contradicts: Array.from(new Set([...(existing.contradicts ?? []), ...incoming.contradicts])),
    tags: Array.from(new Set([...(existing.tags ?? []), ...incoming.tags])),
  };
}

function hasTagOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const rightTags = new Set(right.map((tag) => tag.toLowerCase()));
  return left.some((tag) => rightTags.has(tag.toLowerCase()));
}

function statusPriority(status: Memory["status"]) {
  switch (status) {
    case "verified":
      return 4;
    case "observed":
      return 3;
    case "proposed":
      return 2;
    case "superseded":
      return 1;
    default:
      return 0;
  }
}

function pickLongerText(left: string, right: string) {
  return right.length > left.length ? right : left;
}
