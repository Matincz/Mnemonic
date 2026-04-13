import { nanoid } from "nanoid";
import type { ParsedSession, Memory } from "../types";
import { llmGenerateJSON } from "../llm";
import { ingestPrompt } from "../llm/prompts";

interface RawMemory {
  layer: Memory["layer"];
  title: string;
  summary: string;
  details: string;
  tags: string[];
  salience: number;
}

export async function ingest(session: ParsedSession): Promise<Memory[]> {
  const rawMemories = await llmGenerateJSON<RawMemory[]>(ingestPrompt(session));

  return rawMemories.map((raw) => ({
    id: `mem-${nanoid(12)}`,
    layer: raw.layer,
    title: raw.title,
    summary: raw.summary,
    details: raw.details,
    tags: raw.tags,
    project: session.project,
    sourceSessionId: session.id,
    sourceAgent: session.source,
    createdAt: new Date().toISOString(),
    salience: Math.max(0, Math.min(1, raw.salience)),
    linkedMemoryIds: [],
    contradicts: [],
  }));
}
