import type { Memory } from "../types";
import { nanoid } from "nanoid";
import { llmGenerateJSON } from "../llm";
import { consolidateBatchPrompt } from "../llm/prompts";
import { BatchConsolidationResultSchema } from "../llm/schemas";
import type { Storage } from "../storage";

interface ConsolidationResult {
  memory_id?: string;
  action: "none" | "update-existing" | "create-synthesis";
  target_id?: string;
  layer?: Memory["layer"];
  title?: string;
  summary?: string;
  details?: string;
  tags?: string[];
  salience?: number;
  linked_ids?: string[];
  reason?: string;
}

export async function consolidate(memories: Memory[], storage: Storage): Promise<Memory[]> {
  if (memories.length === 0) {
    return [];
  }

  const outputs = [...memories];

  const related = await storage.findRelatedMemoriesBatch(memories, {
    limit: 12,
    layers: ["semantic", "procedural", "insight"],
  });

  const items = memories
    .map((memory, index) => ({
      memory,
      candidates: (related[index] ?? []).map((result) => result.memory).filter((candidate) => candidate.id !== memory.id),
    }))
    .filter((item) => item.candidates.length > 0);

  if (items.length === 0) {
    return memories;
  }

  const results = await llmGenerateJSON(consolidateBatchPrompt(items), BatchConsolidationResultSchema);
  const resultMap = new Map(
    results
      .filter((result) => typeof result.memory_id === "string" && result.memory_id.length > 0)
      .map((result) => [result.memory_id as string, result]),
  );

  for (const { memory, candidates } of items) {
    const result = resultMap.get(memory.id);
    if (
      !result ||
      result.action === "none" ||
      !result.layer ||
      !isDurableLayer(result.layer) ||
      !result.title ||
      !result.summary ||
      !result.details
    ) {
      continue;
    }

    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const linkedIds = (result.linked_ids ?? []).filter((id) => candidateIds.has(id));

    if (result.action === "update-existing" && result.target_id && candidateIds.has(result.target_id)) {
      const existing = storage.getMemory(result.target_id);
      if (!existing) {
        continue;
      }

      const updated: Memory = {
        ...existing,
        layer: result.layer,
        title: result.title,
        summary: result.summary,
        details: result.details,
        tags: Array.from(new Set([...(result.tags ?? []), ...existing.tags, ...memory.tags])),
        updatedAt: new Date().toISOString(),
        salience: clampSalience(result.salience ?? Math.max(existing.salience, memory.salience)),
        sourceSessionIds: Array.from(
          new Set([...(existing.sourceSessionIds ?? []), ...memory.sourceSessionIds, memory.sourceSessionId]),
        ),
        supportingMemoryIds: Array.from(new Set([...(existing.supportingMemoryIds ?? []), memory.id])),
        linkedMemoryIds: Array.from(new Set([...(existing.linkedMemoryIds ?? []), ...linkedIds, memory.id])),
        contradicts: Array.from(new Set([...(existing.contradicts ?? []), ...memory.contradicts])),
        createdAt: existing.createdAt,
      };
      updated.status = promoteStatus(updated);
      outputs.push(updated);
      continue;
    }

    if (result.action === "create-synthesis") {
      outputs.push({
        id: `mem-${nanoid(12)}`,
        layer: result.layer,
        title: result.title,
        summary: result.summary,
        details: result.details,
        tags: Array.from(new Set([...(result.tags ?? []), ...memory.tags])),
        project: memory.project,
        sourceSessionId: memory.sourceSessionId,
        sourceAgent: memory.sourceAgent,
        createdAt: memory.createdAt,
        updatedAt: memory.createdAt,
        status: "observed" as const,
        sourceSessionIds: Array.from(new Set([...memory.sourceSessionIds, memory.sourceSessionId])),
        supportingMemoryIds: [memory.id],
        salience: clampSalience(result.salience ?? memory.salience),
        linkedMemoryIds: Array.from(new Set([...linkedIds, memory.id])),
        contradicts: [...memory.contradicts],
      });
    }
  }

  return mergeConsolidationOutputs(outputs);
}

function mergeConsolidationOutputs(memories: Memory[]): Memory[] {
  const grouped = new Map<string, Memory[]>();
  for (const memory of memories) {
    const group = grouped.get(memory.id) ?? [];
    group.push(memory);
    grouped.set(memory.id, group);
  }

  return [...grouped.values()].map((versions) => {
    if (versions.length === 1) {
      return versions[0]!;
    }

    return versions.reduce((merged, current) => ({
      ...merged,
      tags: Array.from(new Set([...merged.tags, ...current.tags])),
      updatedAt: latestTimestamp(merged.updatedAt, current.updatedAt),
      status: latestTimestamp(merged.updatedAt, current.updatedAt) === current.updatedAt ? current.status : merged.status,
      sourceSessionIds: Array.from(new Set([...merged.sourceSessionIds, ...current.sourceSessionIds])),
      supportingMemoryIds: Array.from(new Set([...merged.supportingMemoryIds, ...current.supportingMemoryIds])),
      linkedMemoryIds: Array.from(new Set([...merged.linkedMemoryIds, ...current.linkedMemoryIds])),
      contradicts: Array.from(new Set([...merged.contradicts, ...current.contradicts])),
      details: merged.details.length >= current.details.length ? merged.details : current.details,
      salience: Math.max(merged.salience, current.salience),
    }));
  });
}

function clampSalience(value: number) {
  return Math.max(0, Math.min(1, value));
}

function promoteStatus(memory: Memory): Memory["status"] {
  if (memory.status === "verified" || memory.status === "superseded") {
    return memory.status;
  }

  const uniqueSessions = new Set(memory.sourceSessionIds).size;
  if (uniqueSessions >= 3) {
    return "verified";
  }

  return memory.status;
}

function isDurableLayer(layer: Memory["layer"]): layer is "semantic" | "procedural" | "insight" {
  return layer !== "episodic";
}

function latestTimestamp(left: string, right: string) {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();

  if (!Number.isFinite(leftTime)) {
    return right;
  }

  if (!Number.isFinite(rightTime)) {
    return left;
  }

  return rightTime >= leftTime ? right : left;
}
