import type { Memory } from "../types";
import type { Storage } from "../storage";

/**
 * Reflection finds cross-session patterns and generates insight memories.
 * For v1, this is a no-op — insight generation will be added later.
 * Future: periodically scan recent memories for patterns.
 */
export async function reflect(_memories: Memory[], _storage: Storage): Promise<Memory[]> {
  return [];
}
