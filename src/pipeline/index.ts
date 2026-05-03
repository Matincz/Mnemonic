import type { Memory, ParsedSession, PipelineResult } from "../types";
import { createHash } from "crypto";
import type { Storage } from "../storage";
import type { WikiEngine } from "../wiki/engine";
import type { IndexManager } from "../wiki/index-manager";
import type { WikiLog } from "../wiki/log";
import type { EntityRegistry } from "../wiki/registry";
import { evaluate } from "./evaluator";
import { ingest } from "./ingestor";
import { normalize } from "./normalizer";
import { linkBatch } from "./linker";
import { consolidate } from "./consolidator";
import { reflect } from "./reflector";
import { wikiIngest } from "./wiki-ingestor";
import { propagateVerificationSignals } from "./status-updater";

export interface WikiDeps {
  engine: WikiEngine;
  index: IndexManager;
  log: WikiLog;
  registry: EntityRegistry;
}

type CheckpointStage =
  | "evaluating"
  | "ingesting"
  | "linking"
  | "consolidating"
  | "reflecting"
  | "status-updating"
  | "wiki";

export async function processSession(
  session: ParsedSession,
  storage: Storage,
  wiki: WikiDeps,
  log: (msg: string) => void = console.log,
  checkpointKey = buildSessionCheckpointKey(session),
): Promise<PipelineResult> {
  log(`[pipeline] Evaluating session ${session.id} from ${session.source}`);

  const evalResult = await runStage(
    storage,
    session.id,
    "evaluating",
    checkpointKey,
    () => evaluate(session),
  );
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

  // Save raw session
  const rawContent = session.messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");
  wiki.engine.saveRawSession(session.id, rawContent);

  log(`[pipeline] Extracting memories...`);
  const extracted = await runStage(storage, session.id, "ingesting", checkpointKey, () => ingest(session, storage));

  const normalized = normalize(extracted);
  log(`[pipeline] Normalized ${extracted.length} → ${normalized.length} memories`);

  const warnings: string[] = [];

  log(`[pipeline] Linking ${normalized.length} memories...`);
  let linked = normalized;
  try {
    linked = await runStage(storage, session.id, "linking", checkpointKey, () => linkBatch(normalized, storage));
  } catch (err) {
    const msg = "linking failed: " + (err instanceof Error ? err.message : String(err));
    warnings.push(msg);
    log("[pipeline] ⚠ " + msg);
  }

  log(`[pipeline] Consolidating durable knowledge...`);
  let consolidated = linked;
  try {
    consolidated = await runStage(storage, session.id, "consolidating", checkpointKey, () => consolidate(linked, storage));
  } catch (err) {
    const msg = "consolidating failed: " + (err instanceof Error ? err.message : String(err));
    warnings.push(msg);
    log("[pipeline] ⚠ " + msg);
  }

  // Enrichment stages are fail-open so durable memories still persist.
  let insights: Memory[] = [];

  try {
    log("[pipeline] Reflecting insights...");
    insights = await runStage(storage, session.id, "reflecting", checkpointKey, () => reflect(consolidated, storage));
  } catch (err) {
    const msg = "reflect failed: " + (err instanceof Error ? err.message : String(err));
    warnings.push(msg);
    log("[pipeline] ⚠ " + msg);
  }

  let wikiOps: PipelineResult["wikiOps"] = [];
  const persistedMemories = [...consolidated, ...insights];

  try {
    log("[pipeline] Propagating verification signals...");
    await runStage(storage, session.id, "status-updating", checkpointKey, async () => {
      await propagateVerificationSignals(session, persistedMemories, storage);
      return { done: true };
    });
  } catch (err) {
    const msg = "status-updater failed: " + (err instanceof Error ? err.message : String(err));
    warnings.push(msg);
    log("[pipeline] ⚠ " + msg);
  }

  try {
    log("[pipeline] Wiki ingesting...");
    const operations = await runStage(storage, session.id, "wiki", checkpointKey, () =>
      wikiIngest(session, wiki.engine, wiki.index, wiki.log, wiki.registry),
    );
    log("[pipeline] Done. Updated " + operations.length + " wiki pages.");
    wikiOps = operations.map((op) => ({
      action: op.action,
      type: op.type,
      slug: op.slug,
      title: op.title,
      reason: op.reason,
    }));
  } catch (err) {
    const msg = "wiki-ingest failed: " + (err instanceof Error ? err.message : String(err));
    warnings.push(msg);
    log("[pipeline] ⚠ " + msg);
  }

  return {
    sessionId: session.id,
    stage: "done",
    memories: persistedMemories,
    skipped: false,
    wikiOps,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

async function runStage<T>(
  storage: Storage,
  sessionId: string,
  stage: CheckpointStage,
  checkpointKey: string,
  action: () => Promise<T>,
): Promise<T> {
  const scopedStage = `${stage}:${checkpointKey}`;
  const cached = storage.db.loadCheckpoint<T>(sessionId, scopedStage);
  if (cached !== null) {
    return cached;
  }

  const result = await action();
  storage.db.saveCheckpoint(sessionId, scopedStage, result);
  return result;
}

function buildSessionCheckpointKey(session: ParsedSession) {
  const normalized = [
    session.source,
    session.timestamp.toISOString(),
    session.project ?? "",
    session.rawPath,
    session.messages.map((message) => `${message.role}:${message.timestamp?.toISOString() ?? ""}:${message.content}`).join("\n"),
  ].join("\n");

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
