import type { Memory } from "../types";
import { textSimilarity } from "../pipeline/normalizer";
import { batchPairwiseSimilarity, type SemanticSimilarityOptions } from "../pipeline/similarity";

interface DeduplicateReport {
  totalBefore: number;
  totalAfter: number;
  removed: number;
  mergedGroups: number;
}

export interface DeduplicateResult {
  memories: Memory[];
  report: DeduplicateReport;
}

const LEXICAL_DUPLICATE_THRESHOLD = 0.82;
const TAGGED_DUPLICATE_THRESHOLD = 0.78;
const TAGGED_SUMMARY_THRESHOLD = 0.55;
const TITLE_CONTAINMENT_MIN_TOKENS = 2;
const TITLE_CONTAINMENT_SUMMARY_THRESHOLD = 0.45;
const TITLE_CONTAINMENT_COMBINED_THRESHOLD = 0.55;
const SEMANTIC_PRESCREEN_THRESHOLD = 0.35;
const SEMANTIC_DUPLICATE_THRESHOLD = 0.84;

export async function deduplicateMemoryCorpus(
  memories: Memory[],
  options: SemanticSimilarityOptions = {},
): Promise<DeduplicateResult> {
  const exactTitlePass = mergeGroups(groupByNormalizedTitle(memories));
  const nearDuplicatePairs = await buildNearDuplicatePairSet(exactTitlePass.memories, options);
  const grouped: Memory[][] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < exactTitlePass.memories.length; index += 1) {
    if (consumed.has(index)) {
      continue;
    }

    const seed = exactTitlePass.memories[index]!;
    const group = [seed];
    consumed.add(index);

    for (let candidateIndex = index + 1; candidateIndex < exactTitlePass.memories.length; candidateIndex += 1) {
      if (consumed.has(candidateIndex)) {
        continue;
      }

      const candidate = exactTitlePass.memories[candidateIndex]!;
      if (!nearDuplicatePairs.has(pairKey(index, candidateIndex))) {
        continue;
      }

      group.push(candidate);
      consumed.add(candidateIndex);
    }

    grouped.push(group);
  }

  const nearDuplicatePass = mergeGroups(grouped);
  const totalMergedGroups = exactTitlePass.report.mergedGroups + nearDuplicatePass.report.mergedGroups;

  return {
    memories: nearDuplicatePass.memories,
    report: {
      totalBefore: memories.length,
      totalAfter: nearDuplicatePass.memories.length,
      removed: memories.length - nearDuplicatePass.memories.length,
      mergedGroups: totalMergedGroups,
    },
  };
}

export function deduplicateExactTitleGroups(memories: Memory[]): DeduplicateResult {
  return mergeGroups(groupByNormalizedTitle(memories));
}

function groupByNormalizedTitle(memories: Memory[]) {
  const groups = new Map<string, Memory[]>();
  for (const memory of memories) {
    const key = [memory.layer, memory.project ?? "(none)", normalizeTitle(memory.title)].join("::");
    const group = groups.get(key) ?? [];
    group.push(memory);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function mergeGroups(groups: Memory[][]): DeduplicateResult {
  let mergedGroups = 0;
  const deduplicated = groups.map((group) => {
    if (group.length === 1) {
      return group[0]!;
    }

    mergedGroups += 1;
    return mergeMemoryGroup(group);
  });

  deduplicated.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    memories: deduplicated,
    report: {
      totalBefore: groups.reduce((count, group) => count + group.length, 0),
      totalAfter: deduplicated.length,
      removed: groups.reduce((count, group) => count + group.length, 0) - deduplicated.length,
      mergedGroups,
    },
  };
}

function normalizeTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeMemoryGroup(group: Memory[]): Memory {
  const canonical = group.slice().sort(compareCanonicalMemory)[0]!;
  const latest = group.slice().sort((left, right) => compareIsoDates(right.updatedAt, left.updatedAt))[0]!;

  return {
    ...canonical,
    layer: pickMostDurableLayer(group),
    summary: longestText(group.map((memory) => memory.summary)),
    details: longestText(group.map((memory) => memory.details)),
    project: canonical.project ?? latest.project,
    sourceSessionId: latest.sourceSessionId,
    sourceAgent: latest.sourceAgent,
    createdAt: canonical.createdAt,
    updatedAt: latest.updatedAt,
    status: pickHighestStatus(group),
    sourceSessionIds: unique(group.flatMap((memory) => memory.sourceSessionIds)),
    sourceAgents: unique(group.flatMap((memory) => memory.sourceAgents ?? [memory.sourceAgent])),
    supportingMemoryIds: unique(group.flatMap((memory) => memory.supportingMemoryIds)),
    salience: Math.max(...group.map((memory) => memory.salience)),
    linkedMemoryIds: unique(group.flatMap((memory) => memory.linkedMemoryIds)),
    contradicts: unique(group.flatMap((memory) => memory.contradicts)),
    tags: unique(group.flatMap((memory) => memory.tags)),
  };
}

function compareCanonicalMemory(left: Memory, right: Memory) {
  return (
    compareNumbers(right.supportingMemoryIds.length, left.supportingMemoryIds.length) ||
    compareNumbers(right.details.length, left.details.length) ||
    compareIsoDates(right.updatedAt, left.updatedAt) ||
    compareIsoDates(right.createdAt, left.createdAt) ||
    compareNumbers(right.salience, left.salience)
  );
}

function compareNumbers(left: number, right: number) {
  return left === right ? 0 : left > right ? 1 : -1;
}

function compareIsoDates(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return left.localeCompare(right);
  }

  return compareNumbers(leftTime, rightTime);
}

function longestText(values: string[]) {
  return values.slice().sort((left, right) => right.length - left.length)[0] ?? "";
}

function unique<T extends string>(values: T[]) {
  return Array.from(new Set(values));
}

function pickMostDurableLayer(group: Memory[]): Memory["layer"] {
  const priority: Record<Memory["layer"], number> = {
    insight: 4,
    procedural: 3,
    semantic: 2,
    episodic: 1,
  };

  return group
    .slice()
    .sort((left, right) => priority[right.layer] - priority[left.layer])[0]?.layer ?? "episodic";
}

function pickHighestStatus(group: Memory[]): Memory["status"] {
  const priority: Record<Memory["status"], number> = {
    verified: 4,
    observed: 3,
    proposed: 2,
    superseded: 1,
  };

  return group
    .slice()
    .sort((left, right) => priority[right.status] - priority[left.status])[0]?.status ?? "observed";
}

async function buildNearDuplicatePairSet(memories: Memory[], options: SemanticSimilarityOptions) {
  const pairs = new Set<string>();
  const semanticCandidates: Array<{ leftIndex: number; rightIndex: number; text: [string, string] }> = [];

  for (let leftIndex = 0; leftIndex < memories.length; leftIndex += 1) {
    const left = memories[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < memories.length; rightIndex += 1) {
      const right = memories[rightIndex]!;
      const lexical = crossBatchLexicalDuplicate(left, right);
      if (lexical === "duplicate") {
        pairs.add(pairKey(leftIndex, rightIndex));
        continue;
      }

      if (lexical === "candidate") {
        semanticCandidates.push({
          leftIndex,
          rightIndex,
          text: [semanticDeduplicateText(left), semanticDeduplicateText(right)],
        });
      }
    }
  }

  if (semanticCandidates.length === 0) {
    return pairs;
  }

  const scores = await batchPairwiseSimilarity(semanticCandidates.map((candidate) => candidate.text), options);
  for (let index = 0; index < semanticCandidates.length; index += 1) {
    if ((scores[index] ?? 0) >= SEMANTIC_DUPLICATE_THRESHOLD) {
      const candidate = semanticCandidates[index]!;
      pairs.add(pairKey(candidate.leftIndex, candidate.rightIndex));
    }
  }

  return pairs;
}

function pairKey(leftIndex: number, rightIndex: number) {
  return `${leftIndex}:${rightIndex}`;
}

function crossBatchLexicalDuplicate(left: Memory, right: Memory): "duplicate" | "candidate" | "none" {
  if (left.id === right.id || left.layer !== right.layer) {
    return "none";
  }

  if (left.project && right.project && left.project !== right.project) {
    return "none";
  }

  const titleSimilarity = textSimilarity(left.title, right.title);
  const summarySimilarity = textSimilarity(left.summary, right.summary);
  const combinedSimilarity = textSimilarity(
    [left.title, left.summary].join(" "),
    [right.title, right.summary].join(" "),
  );

  if (titleSimilarity >= LEXICAL_DUPLICATE_THRESHOLD || combinedSimilarity >= LEXICAL_DUPLICATE_THRESHOLD) {
    return "duplicate";
  }

  if (isTitleContainmentDuplicate(left.title, right.title)) {
    if (
      summarySimilarity >= TITLE_CONTAINMENT_SUMMARY_THRESHOLD ||
      combinedSimilarity >= TITLE_CONTAINMENT_COMBINED_THRESHOLD ||
      hasTagOverlap(left.tags, right.tags)
    ) {
      return "duplicate";
    }
  }

  if (
    hasTagOverlap(left.tags, right.tags) &&
    combinedSimilarity >= TAGGED_DUPLICATE_THRESHOLD &&
    summarySimilarity >= TAGGED_SUMMARY_THRESHOLD
  ) {
    return "duplicate";
  }

  if (
    hasTagOverlap(left.tags, right.tags) &&
    Math.max(titleSimilarity, summarySimilarity, combinedSimilarity) >= SEMANTIC_PRESCREEN_THRESHOLD
  ) {
    return "candidate";
  }

  return "none";
}

function isTitleContainmentDuplicate(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const larger = leftTokens.size <= rightTokens.size ? rightTokens : leftTokens;

  if (smaller.size < TITLE_CONTAINMENT_MIN_TOKENS) {
    return false;
  }

  for (const token of smaller) {
    if (!larger.has(token)) {
      return false;
    }
  }

  return true;
}

function titleTokens(title: string) {
  const stopWords = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  );
}

function semanticDeduplicateText(memory: Memory) {
  return [memory.title, memory.summary, memory.details].filter(Boolean).join("\n");
}

function hasTagOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const rightSet = new Set(right.map((tag) => tag.toLowerCase()));
  return left.some((tag) => rightSet.has(tag.toLowerCase()));
}
