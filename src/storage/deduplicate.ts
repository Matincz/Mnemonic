import type { Memory } from "../types";
import { textSimilarity } from "../pipeline/normalizer";

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

export function deduplicateMemoryCorpus(memories: Memory[]): DeduplicateResult {
  const exactTitlePass = mergeGroups(groupByNormalizedTitle(memories));
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
      if (!isCrossBatchNearDuplicate(seed, candidate)) {
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
    const key = normalizeTitle(memory.title);
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

function unique(values: string[]) {
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

function isCrossBatchNearDuplicate(left: Memory, right: Memory) {
  if (left.id === right.id || left.layer !== right.layer) {
    return false;
  }

  if (left.project && right.project && left.project !== right.project) {
    return false;
  }

  const titleSimilarity = textSimilarity(left.title, right.title);
  const summarySimilarity = textSimilarity(left.summary, right.summary);
  const combinedSimilarity = textSimilarity(
    [left.title, left.summary].join(" "),
    [right.title, right.summary].join(" "),
  );

  if (titleSimilarity >= 0.65 || combinedSimilarity >= 0.70) {
    return true;
  }

  return hasTagOverlap(left.tags, right.tags) && titleSimilarity >= 0.45 && summarySimilarity >= 0.45;
}

function hasTagOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const rightSet = new Set(right.map((tag) => tag.toLowerCase()));
  return left.some((tag) => rightSet.has(tag.toLowerCase()));
}
