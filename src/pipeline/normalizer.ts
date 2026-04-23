import type { Memory } from "../types";

export function normalize(memories: Memory[]): Memory[] {
  let result = memories;

  result = result.filter((memory) => {
    const details = memory.details.trim();
    if (!details) return false;
    if (textSimilarity(memory.summary, memory.details) > 0.9) return false;
    if (textSimilarity(memory.title, memory.summary) > 0.9 && details.length < 50) return false;
    if (memory.summary.trim().length < 50 && details.length < 80) return false;
    return true;
  });

  result = mergeNearDuplicates(result);

  result = result.map((memory) => {
    if (
      (memory.layer === "semantic" || memory.layer === "procedural") &&
      memory.salience < 0.4 &&
      memory.details.length < 80
    ) {
      return { ...memory, layer: "episodic" as const };
    }
    return memory;
  });

  return result;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter((token) => token.length > 0));
}

export function textSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function mergeNearDuplicates(memories: Memory[]): Memory[] {
  const result: Memory[] = [];
  const merged = new Set<number>();

  for (let i = 0; i < memories.length; i++) {
    if (merged.has(i)) continue;

    let best = memories[i]!;
    for (let j = i + 1; j < memories.length; j++) {
      if (merged.has(j)) continue;

      const candidate = memories[j]!;
      if (!isNearDuplicate(best, candidate)) continue;

      if (candidate.details.length > best.details.length) {
        best = {
          ...candidate,
          tags: Array.from(new Set([...best.tags, ...candidate.tags])),
          linkedMemoryIds: Array.from(new Set([...best.linkedMemoryIds, ...candidate.linkedMemoryIds])),
          salience: Math.max(best.salience, candidate.salience),
        };
      } else {
        best = {
          ...best,
          tags: Array.from(new Set([...best.tags, ...candidate.tags])),
          linkedMemoryIds: Array.from(new Set([...best.linkedMemoryIds, ...candidate.linkedMemoryIds])),
          salience: Math.max(best.salience, candidate.salience),
        };
      }

      merged.add(j);
    }

    result.push(best);
  }

  return result;
}

function isNearDuplicate(a: Memory, b: Memory): boolean {
  const titleSim = textSimilarity(a.title, b.title);
  if (titleSim > 0.7) return true;

  const summarySim = textSimilarity(a.summary, b.summary);
  if (summarySim > 0.6) return true;

  if (titleSim > 0.5 && summarySim > 0.4) return true;

  return false;
}
