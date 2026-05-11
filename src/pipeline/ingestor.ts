import { nanoid } from "nanoid";
import type { ParsedSession, Memory, MemorySearchResult } from "../types";
import { llmGenerateJSON } from "../llm";
import { ingestPrompt } from "../llm/prompts";
import { RawMemorySchema } from "../llm/schemas";
import type { Storage } from "../storage";
import { getLogger } from "../logger";
import { batchPairwiseSimilarity } from "./similarity";
import { inferProjectFromText, normalizeProjectName } from "./project";
import { calibrateSalience } from "./salience";

const DEDUPLICATION_COMBINED_THRESHOLD = 0.78;
const HIGH_CONFIDENCE_TITLE_THRESHOLD = 0.85;
const CROSS_PROJECT_TITLE_THRESHOLD = 0.95;
const CROSS_LAYER_LINK_THRESHOLD = 0.92;
const EMBEDDING_ONLY_DUPLICATE_THRESHOLD = 0.88;
const logger = getLogger("pipeline.ingestor");

export async function ingest(
  session: ParsedSession,
  storage?: Pick<Storage, "findRelatedMemoriesBatch" | "config">,
  metrics?: {
    ingestedRaw?: number;
    ingestedAfterCalibration?: number;
    ingestedAfterDedup?: number;
    dedupMerged?: number;
    dedupDropped?: number;
  },
): Promise<Memory[]> {
  const rawMemories = await llmGenerateJSON(ingestPrompt(session), RawMemorySchema, {
    component: "ingestor",
    schemaName: "RawMemorySchema",
  });
  if (metrics) {
    metrics.ingestedRaw = rawMemories.length;
  }
  const project = inferProject(session);

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
      sourceAgents: [session.source],
      supportingMemoryIds: [],
      salience: Math.max(0, Math.min(1, raw.salience)),
      linkedMemoryIds: [],
      contradicts: [],
    };
  });
  const calibrated = calibrateSalience(extracted);
  if (metrics) {
    metrics.ingestedAfterCalibration = calibrated.length;
  }

  if (!storage || calibrated.length === 0) {
    if (metrics) {
      metrics.ingestedAfterDedup = calibrated.length;
      metrics.dedupMerged = 0;
      metrics.dedupDropped = 0;
    }
    return calibrated;
  }

  let relatedByMemory: MemorySearchResult[][] = [];
  try {
    relatedByMemory = await storage.findRelatedMemoriesBatch(calibrated, { limit: 15 });
  } catch (error) {
    logger.warn("related memory lookup failed", { error: formatError(error) });
    relatedByMemory = calibrated.map(() => []);
  }

  const decisions = await Promise.allSettled(
    calibrated.map((memory, index) => findDuplicateCandidate(memory, relatedByMemory[index] ?? [], storage)),
  );

  let dedupMerged = 0;
  let dedupDropped = 0;
  const deduplicated = calibrated.flatMap((memory, index) => {
    const decision = decisions[index];
    if (decision?.status === "rejected") {
      logger.warn("duplicate detection failed", { memoryId: memory.id, error: formatError(decision.reason) });
    }
    const duplicate = decision?.status === "fulfilled" ? decision.value.duplicate : null;
    const linkedMemoryIds = decision?.status === "fulfilled" ? decision.value.linkedMemoryIds : [];

    const memoryWithLinks =
      linkedMemoryIds.length === 0
        ? memory
        : {
            ...memory,
            linkedMemoryIds: Array.from(new Set([...(memory.linkedMemoryIds ?? []), ...linkedMemoryIds])),
          };

    if (!duplicate) {
      return [memoryWithLinks];
    }

    if (shouldUpdateExistingMemory(memoryWithLinks, duplicate)) {
      dedupMerged += 1;
      return [mergeIntoExistingMemory(memoryWithLinks, duplicate)];
    }

    dedupDropped += 1;
    return [];
  });

  if (metrics) {
    metrics.ingestedAfterDedup = deduplicated.length;
    metrics.dedupMerged = dedupMerged;
    metrics.dedupDropped = dedupDropped;
  }

  return deduplicated;
}

function inferProject(session: ParsedSession) {
  const explicit = normalizeProjectName(session.project);
  if (explicit) {
    return explicit;
  }

  return inferProjectFromText(
    [
      session.rawPath,
      ...session.messages.map((message) => message.content),
    ].join("\n"),
  );
}

async function findDuplicateCandidate(
  memory: Memory,
  candidates: MemorySearchResult[],
  storage?: Pick<Storage, "config">,
) {
  let bestMatch: { candidate: Memory; score: number } | null = null;
  const linkedMemoryIds: string[] = [];

  if (candidates.length === 0) {
    return { duplicate: null, linkedMemoryIds };
  }

  const pairs: Array<[string, string]> = [];
  for (const { memory: candidate } of candidates) {
    pairs.push([memory.title, candidate.title]);
    pairs.push([memory.summary, candidate.summary]);
    pairs.push(
      [[memory.title, memory.summary].join(" "), [candidate.title, candidate.summary].join(" ")] as [string, string],
    );
  }
  const similarities = await batchPairwiseSimilarity(pairs, { storage });

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!.memory;
    const offset = index * 3;
    const titleSimilarity = similarities[offset] ?? 0;
    const summarySimilarity = similarities[offset + 1] ?? 0;
    const combinedSimilarity = similarities[offset + 2] ?? 0;
    const score = Math.max(titleSimilarity, summarySimilarity, combinedSimilarity);
    const searchHit = candidates[index];
    const embeddingOnlyScore = searchHit?.reasons.includes("semantic") ? searchHit.score : 0;

    if (
      embeddingOnlyScore >= EMBEDDING_ONLY_DUPLICATE_THRESHOLD &&
      hasCompatibleProjectForEmbeddingMerge(memory.project, candidate.project)
    ) {
      if (!bestMatch || embeddingOnlyScore > bestMatch.score) {
        bestMatch = { candidate, score: embeddingOnlyScore };
      }
      continue;
    }

    if (candidate.layer !== memory.layer) {
      if (score >= CROSS_LAYER_LINK_THRESHOLD) {
        linkedMemoryIds.push(candidate.id);
      }
      continue;
    }

    const sameProject = isSameProject(memory.project, candidate.project);
    if (!sameProject && memory.project && candidate.project && titleSimilarity < CROSS_PROJECT_TITLE_THRESHOLD) {
      continue;
    }

    const tagOverlap = hasTagOverlap(memory.tags, candidate.tags);
    const exactEnough = titleSimilarity >= HIGH_CONFIDENCE_TITLE_THRESHOLD;
    const similarEnough = combinedSimilarity >= DEDUPLICATION_COMBINED_THRESHOLD && (tagOverlap || sameProject);
    if (!exactEnough && !similarEnough) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { candidate, score };
    }
  }

  return {
    duplicate: bestMatch?.candidate ?? null,
    linkedMemoryIds: Array.from(new Set(linkedMemoryIds)),
  };
}

function hasCompatibleProjectForEmbeddingMerge(left?: string, right?: string) {
  return left === right || !left || !right;
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
    sourceSessionId: existing.sourceSessionId,
    sourceAgent: existing.sourceAgent,
    updatedAt: incoming.updatedAt,
    status: statusPriority(incoming.status) > statusPriority(existing.status) ? incoming.status : existing.status,
    sourceSessionIds: Array.from(new Set([...(existing.sourceSessionIds ?? []), ...incoming.sourceSessionIds])),
    sourceAgents: Array.from(new Set([...(existing.sourceAgents ?? [existing.sourceAgent]), ...(incoming.sourceAgents ?? [incoming.sourceAgent])])),
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

function isSameProject(left?: string, right?: string) {
  if (!left || !right) {
    return false;
  }
  return left === right;
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

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
