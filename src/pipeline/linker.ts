import type { Memory } from "../types";
import { llmGenerateJSON } from "../llm";
import { linkPrompt } from "../llm/prompts";
import type { Storage } from "../storage";

interface LinkResult {
  linked_ids: string[];
  contradicts_ids: string[];
  explanation: string;
}

export async function link(memory: Memory, storage: Storage): Promise<Memory> {
  // Find potentially related memories by tags and text search
  const candidates: Memory[] = [];
  for (const tag of memory.tags) {
    const found = storage.searchText(tag, 5);
    for (const f of found) {
      if (f.id !== memory.id && !candidates.some((c) => c.id === f.id)) {
        candidates.push(f);
      }
    }
  }

  if (candidates.length === 0) return memory;

  const result = await llmGenerateJSON<LinkResult>(linkPrompt(memory, candidates.slice(0, 10)));

  return {
    ...memory,
    linkedMemoryIds: result.linked_ids.filter((id) => candidates.some((c) => c.id === id)),
    contradicts: result.contradicts_ids.filter((id) => candidates.some((c) => c.id === id)),
  };
}
