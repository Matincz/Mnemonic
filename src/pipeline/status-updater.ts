import type { Memory, ParsedSession } from "../types";
import type { Storage } from "../storage";
import { normalizeProjectName } from "./project";
import { batchPairwiseSimilarity } from "./similarity";

const VERIFICATION_TEXT_REGEX = /\b(?:all tests?\s*pass(?:ed)?|tests?\s+pass(?:ed)?|build success(?:ful)?|deployed|deployment succeeded|merged|fix(?:ed)?\s+confirmed)\b/i;
const WEAK_VERIFICATION_REGEX = /\b(?:will|plan(?:ned)?|planning|might|maybe|should|would|could|next week|tomorrow|merge conflict)\b/i;
const EXIT_CODE_ZERO_REGEX = /\bexit[_ ]?code["']?\s*[:=]\s*0\b/i;
const VERIFICATION_COMMAND_REGEX = /\b(?:bun test|npm test|pnpm test|yarn test|pytest|go test|cargo test|git merge|deploy)\b/i;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export async function propagateVerificationSignals(
  session: ParsedSession,
  memories: Memory[],
  storage: Storage,
): Promise<number> {
  if (process.env.MNEMONIC_DISABLE_VERIFICATION_PROPAGATION === "1") {
    return 0;
  }

  if (memories.length === 0 || !hasVerificationSignal(session)) {
    return 0;
  }

  const sessionProject = normalizeProjectName(session.project ?? memories.find((memory) => memory.project)?.project);
  const sessionTimestamp = session.timestamp.getTime();
  const cutoff = sessionTimestamp - SEVEN_DAYS_MS;
  const candidates = storage.listAll().filter((memory) => {
    if (memory.status === "verified" || memory.status === "superseded") return false;

    const createdAtMs = new Date(memory.createdAt).getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoff || createdAtMs > sessionTimestamp + MAX_CLOCK_SKEW_MS) {
      return false;
    }

    const candidateProject = normalizeProjectName(memory.project);
    if (sessionProject !== undefined || candidateProject !== undefined) {
      return sessionProject === candidateProject;
    }

    return true;
  });

  if (candidates.length === 0) {
    return 0;
  }

  const associations = await findSemanticAssociations(memories, candidates, storage);
  if (associations.size === 0) {
    return 0;
  }

  const upgraded = candidates
    .filter((candidate) => associations.has(candidate.id))
    .map((candidate) => ({
      ...candidate,
      status: "verified" as const,
      updatedAt: session.timestamp.toISOString(),
      linkedMemoryIds: Array.from(new Set([...(candidate.linkedMemoryIds ?? []), ...(associations.get(candidate.id) ?? [])])),
    }));

  if (upgraded.length > 0) {
    await storage.saveMemories(upgraded);
  }

  return upgraded.length;
}

function hasVerificationSignal(session: ParsedSession) {
  const normalizedMessages = session.messages.map((message) => message.content.trim()).filter(Boolean);

  for (let index = 0; index < normalizedMessages.length; index += 1) {
    const current = normalizedMessages[index] ?? "";
    const next = normalizedMessages[index + 1] ?? "";
    const previous = normalizedMessages[index - 1] ?? "";
    const window = `${previous}\n${current}\n${next}`;

    if (!VERIFICATION_TEXT_REGEX.test(current) || WEAK_VERIFICATION_REGEX.test(current)) {
      continue;
    }

    const anchoredInWindow = EXIT_CODE_ZERO_REGEX.test(window) || VERIFICATION_COMMAND_REGEX.test(window);
    if (anchoredInWindow) {
      return true;
    }
  }

  return false;
}

async function findSemanticAssociations(
  currentMemories: Memory[],
  candidates: Memory[],
  storage: Storage,
): Promise<Map<string, string[]>> {
  const pairs: Array<{ candidateId: string; currentId: string; similarity: number }> = [];
  const similarityPairs: Array<[string, string]> = [];
  const pairRefs: Array<{ candidateId: string; currentId: string }> = [];

  for (const candidate of candidates) {
    const candidateText = memoryText(candidate);
    for (const memory of currentMemories) {
      similarityPairs.push([candidateText, memoryText(memory)]);
      pairRefs.push({ candidateId: candidate.id, currentId: memory.id });
    }
  }

  // batchPairwiseSimilarity already falls back to Jaccard on embedding failure.
  const similarities = await batchPairwiseSimilarity(similarityPairs, { storage });
  for (let index = 0; index < similarities.length; index += 1) {
    const similarity = similarities[index] ?? 0;
    const ref = pairRefs[index];
    if (ref && similarity >= 0.6) {
      pairs.push({ ...ref, similarity });
    }
  }

  const associations = new Map<string, Array<{ id: string; score: number }>>();
  for (const pair of pairs) {
    const existing = associations.get(pair.candidateId) ?? [];
    existing.push({ id: pair.currentId, score: pair.similarity });
    associations.set(pair.candidateId, existing);
  }

  return new Map(
    [...associations.entries()].map(([candidateId, linked]) => [
      candidateId,
      linked
        .sort((a, b) => b.score - a.score)
        .map((item) => item.id)
        .filter((id, index, array) => array.indexOf(id) === index),
    ]),
  );
}

function memoryText(memory: Memory) {
  return [memory.title, memory.summary, memory.details].filter(Boolean).join("\n").trim();
}
