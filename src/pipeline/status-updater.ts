import type { Memory, ParsedSession } from "../types";
import type { Storage } from "../storage";
import { embedTexts, hasEmbeddingProvider } from "../embeddings";
import { normalizeProjectName } from "./project";
import { textSimilarity } from "./normalizer";

const VERIFICATION_TEXT_REGEX = /✓|✅|all tests?\s*pass|build success|deployed|merged|fix(?:ed)?\s+confirmed/i;
const EXIT_CODE_ZERO_REGEX = /\bexit[_ ]?code["']?\s*[:=]\s*0\b/i;
const VERIFICATION_COMMAND_REGEX = /\b(?:bun test|npm test|pnpm test|yarn test|pytest|go test|cargo test|deploy)\b/i;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function propagateVerificationSignals(
  session: ParsedSession,
  memories: Memory[],
  storage: Storage,
): Promise<void> {
  if (memories.length === 0 || !hasVerificationSignal(session)) {
    return;
  }

  const sessionProject = normalizeProjectName(session.project ?? memories.find((memory) => memory.project)?.project);
  const sessionTimestamp = session.timestamp.getTime();
  const cutoff = sessionTimestamp - SEVEN_DAYS_MS;
  const proposedCandidates = storage.listAll().filter((memory) => {
    if (memory.status !== "proposed") return false;

    const createdAtMs = new Date(memory.createdAt).getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoff || createdAtMs > sessionTimestamp) {
      return false;
    }

    const candidateProject = normalizeProjectName(memory.project);
    if (sessionProject !== undefined || candidateProject !== undefined) {
      return sessionProject === candidateProject;
    }

    return true;
  });

  if (proposedCandidates.length === 0) {
    return;
  }

  const associations = await findSemanticAssociations(memories, proposedCandidates, storage);
  if (associations.size === 0) {
    return;
  }

  const upgraded = proposedCandidates
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
}

function hasVerificationSignal(session: ParsedSession) {
  const normalizedMessages = session.messages.map((message) => message.content.trim()).filter(Boolean);
  if (normalizedMessages.some((message) => VERIFICATION_TEXT_REGEX.test(message))) {
    return true;
  }

  for (let index = 0; index < normalizedMessages.length; index += 1) {
    const current = normalizedMessages[index] ?? "";
    const next = normalizedMessages[index + 1] ?? "";
    const previous = normalizedMessages[index - 1] ?? "";
    const window = `${previous}\n${current}\n${next}`;

    const hasExitCodeZero = EXIT_CODE_ZERO_REGEX.test(current) || EXIT_CODE_ZERO_REGEX.test(window);
    const hasVerificationCommand = VERIFICATION_COMMAND_REGEX.test(current) || VERIFICATION_COMMAND_REGEX.test(window);

    if (hasExitCodeZero && hasVerificationCommand) {
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
  const currentTexts = currentMemories.map(memoryText).map((text) => text || "(empty)");
  const candidateTexts = candidates.map(memoryText).map((text) => text || "(empty)");

  if (hasEmbeddingProvider(undefined, storage.config)) {
    try {
      const vectors = await embedTexts([...currentTexts, ...candidateTexts], { config: storage.config });
      if (vectors.length === currentTexts.length + candidateTexts.length) {
        const currentVectors = vectors.slice(0, currentTexts.length);
        const candidateVectors = vectors.slice(currentTexts.length);

        for (const [candidateIndex, candidate] of candidates.entries()) {
          const candidateVector = candidateVectors[candidateIndex];
          if (!candidateVector) continue;

          for (const [currentIndex, memory] of currentMemories.entries()) {
            const currentVector = currentVectors[currentIndex];
            if (!currentVector) continue;

            const similarity = cosineSimilarity(currentVector.values, candidateVector.values);
            if (similarity >= 0.6) {
              pairs.push({ candidateId: candidate.id, currentId: memory.id, similarity });
            }
          }
        }
      }
    } catch {
      // fall through to lexical fallback
    }
  }

  if (pairs.length === 0) {
    for (const candidate of candidates) {
      const candidateText = memoryText(candidate);
      for (const memory of currentMemories) {
        const similarity = textSimilarity(candidateText, memoryText(memory));
        if (similarity >= 0.6) {
          pairs.push({ candidateId: candidate.id, currentId: memory.id, similarity });
        }
      }
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

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
