import type { ParsedSession, PipelineResult, Memory } from "../types";
import type { Storage } from "../storage";
import { evaluate } from "./evaluator";
import { ingest } from "./ingestor";
import { link } from "./linker";
import { consolidate } from "./consolidator";
import { reflect } from "./reflector";
import { getEmbedding } from "../llm";

export async function processSession(
  session: ParsedSession,
  storage: Storage,
  log: (msg: string) => void = console.log
): Promise<PipelineResult> {
  log(`[pipeline] Evaluating session ${session.id} from ${session.source}`);

  // Stage 1: Evaluate
  const evalResult = await evaluate(session);
  if (!evalResult.shouldProcess) {
    log(`[pipeline] Skipped: ${evalResult.reason}`);
    return {
      sessionId: session.id,
      stage: "skipped",
      memories: [],
      skipped: true,
      reason: evalResult.reason,
    };
  }

  // Stage 2: Ingest
  log(`[pipeline] Ingesting...`);
  let memories = await ingest(session);
  log(`[pipeline] Extracted ${memories.length} memories`);

  // Stage 3: Link
  log(`[pipeline] Linking...`);
  const linked: Memory[] = [];
  for (const mem of memories) {
    linked.push(await link(mem, storage));
  }
  memories = linked;

  // Stage 4: Consolidate
  memories = await consolidate(memories, storage);

  // Stage 5: Save all memories
  for (const mem of memories) {
    const embedding = await getEmbedding(`${mem.title}\n${mem.summary}`);
    await storage.saveMemory(mem, embedding);
  }

  // Stage 6: Reflect (generate insights)
  const insights = await reflect(memories, storage);
  for (const insight of insights) {
    const embedding = await getEmbedding(`${insight.title}\n${insight.summary}`);
    await storage.saveMemory(insight, embedding);
    memories.push(insight);
  }

  // Rebuild vault index
  storage.rebuildIndex();

  log(`[pipeline] Done. Saved ${memories.length} memories.`);
  return {
    sessionId: session.id,
    stage: "done",
    memories,
    skipped: false,
  };
}
