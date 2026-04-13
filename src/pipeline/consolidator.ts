import type { Memory } from "../types";
import type { Storage } from "../storage";

/**
 * Consolidation merges duplicate or overlapping memories.
 * For v1, this is a no-op — memories are kept as individual units.
 * Future: detect near-duplicate summaries and merge them.
 */
export async function consolidate(memories: Memory[], _storage: Storage): Promise<Memory[]> {
  return memories;
}
