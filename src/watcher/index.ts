import { existsSync, readdirSync } from "fs";
import { loadConfig, type Config } from "../config";
import { createParsers, AmpParser, OpenCodeParser, type SessionParser } from "../parsers";
import type { Storage } from "../storage";
import { processSession } from "../pipeline";
import type { WikiDeps } from "../pipeline";
import { DebouncedWatcher } from "./fs-watcher";
import { shouldProcess, sessionHash, fileHash } from "./state";
import type { ParsedSession } from "../types";
import type { RuntimeIPC } from "../ipc/runtime";

export class WatcherOrchestrator {
  private watcher?: DebouncedWatcher;
  private processing = new Set<string>();
  private processedSessions = 0;

  constructor(
    private storage: Storage,
    private wiki: WikiDeps,
    private runtime?: RuntimeIPC,
    private cfg: Config = loadConfig(),
    private parserRegistry: Record<string, SessionParser> = createParsers(cfg),
  ) {}

  private get fileSourceConfigs() {
    return [
      { parserName: "codex", root: this.cfg.sources.codex, extension: ".jsonl" },
      { parserName: "claude-code", root: this.cfg.sources.claudeCode, extension: ".jsonl" },
      { parserName: "gemini", root: this.cfg.sources.gemini, extension: ".json" },
      { parserName: "openclaw", root: this.cfg.sources.openclaw, extension: ".jsonl" },
    ] as const;
  }

  private ensureWatcher() {
    this.watcher ??= new DebouncedWatcher(this.cfg.watchDebounceMs);
    return this.watcher;
  }

  start() {
    console.log("[watcher] Starting file watchers...");
    const watcher = this.ensureWatcher();

    // Watch Codex sessions
    watcher.watch(this.cfg.sources.codex, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("codex", path);
    });

    // Watch Claude Code sessions
    watcher.watch(this.cfg.sources.claudeCode, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("claude-code", path);
    });

    // Watch Gemini sessions
    watcher.watch(this.cfg.sources.gemini, (path) => {
      if (path.endsWith(".json")) this.handleFile("gemini", path);
    });

    // Watch OpenCode database
    watcher.watch(this.cfg.sources.opencode.replace("/opencode.db", ""), (path) => {
      if (path.endsWith("opencode.db")) this.handleOpenCode(path);
    });

    // Watch OpenClaw sessions
    watcher.watch(this.cfg.sources.openclaw, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("openclaw", path);
    });

    console.log("[watcher] All watchers active.");
  }

  async backfillAll() {
    console.log("[backfill] Scanning historical sessions...");

    for (const source of this.fileSourceConfigs) {
      await this.backfillFileSource(source.parserName, source.root, source.extension);
    }

    await this.backfillOpenCode(this.cfg.sources.opencode);
    await this.pollAmp();

    console.log("[backfill] Historical scan complete.");
  }

  /** Periodically poll Amp threads (no fs watch available) */
  async pollAmp() {
    const ampParser = this.parserRegistry.amp as AmpParser;
    const threadIds = await ampParser.listRecentThreads();
    const sessions: ParsedSession[] = [];

    for (const tid of threadIds) {
      const session = await ampParser.parse(tid);
      if (session) {
        sessions.push(session);
      }
    }

    sessions.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

    for (const session of sessions) {
      await this.handleSession(session, `amp:${session.id}`, sessionHash(session));
    }
  }

  private async handleFile(parserName: string, filePath: string) {
    if (this.processing.has(filePath)) return;
    if (!shouldProcess(filePath, this.storage)) return;

    this.processing.add(filePath);
    try {
      const parser = this.parserRegistry[parserName];
      if (!parser) return;

      console.log(`[watcher] New/changed: ${filePath} (${parserName})`);
      const session = await parser.parse(filePath);
      if (!session) return;

      await this.handleSession(session, filePath, fileHash(filePath));
    } catch (err) {
      console.error(`[watcher] Error processing ${filePath}:`, err);
      this.recordError(parserName, err);
    } finally {
      this.processing.delete(filePath);
    }
  }

  stop() {
    this.watcher?.close();
  }

  private async backfillFileSource(parserName: string, root: string, extension: string) {
    if (!existsSync(root)) {
      return;
    }

    const files = listFilesRecursively(root, extension);
    for (const filePath of files) {
      await this.handleFile(parserName, filePath);
    }
  }

  private async backfillOpenCode(dbPath: string) {
    if (!existsSync(dbPath)) {
      return;
    }

    await this.handleOpenCode(dbPath);
  }

  private async handleOpenCode(dbPath: string) {
    const processingKey = `opencode-db:${dbPath}`;
    if (this.processing.has(processingKey)) return;

    this.processing.add(processingKey);
    try {
      const parser = this.parserRegistry.opencode as OpenCodeParser;
      const sessions = parser
        .readFromDb(dbPath, { maxAgeDays: null })
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

      for (const session of sessions) {
        await this.handleSession(session, `opencode:${session.id}`, sessionHash(session));
      }
    } catch (err) {
      console.error(`[watcher] Error processing ${dbPath}:`, err);
    } finally {
      this.processing.delete(processingKey);
    }
  }

  private async handleSession(session: ParsedSession, key: string, hash: string) {
    if (this.storage.isProcessed(key, hash)) {
      return;
    }

    const result = await processSession(session, this.storage, this.wiki);
    if (result.warnings?.length) {
      for (const warning of result.warnings) {
        console.warn("[watcher] ⚠ " + warning);
      }
    }
    await this.storage.recordProcessedSession(result.memories, key, hash, session.id);
    this.storage.db.clearCheckpoints(session.id);
    this.recordOutcome(session, result.skipped, result.memories.length, `Processed ${key}`, result.reason);
  }

  private recordOutcome(
    session: ParsedSession,
    skipped: boolean,
    memoryCount: number,
    message: string,
    reason?: string,
  ) {
    if (!this.runtime) {
      return;
    }

    this.processedSessions += 1;
    this.runtime.writeStatus({
      state: "watching",
      message,
      processedSessions: this.processedSessions,
      lastSessionId: session.id,
      lastSource: session.source,
      lastMemoryCount: memoryCount,
    });
    this.runtime.emit({
      kind: skipped ? "session-skipped" : "session-processed",
      timestamp: new Date().toISOString(),
      message: skipped ? `${message} (skipped)` : message,
      sessionId: session.id,
      source: session.source,
      memoryCount,
      details: reason,
    });
  }

  private recordError(source: string, err: unknown) {
    if (!this.runtime) {
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    this.runtime.writeStatus({
      state: "error",
      message: `Error while processing ${source}.`,
      lastError: message,
    });
    this.runtime.emit({
      kind: "session-error",
      timestamp: new Date().toISOString(),
      message: `Error while processing ${source}.`,
      source,
      details: message,
    });
  }
}

function listFilesRecursively(root: string, extension: string): string[] {
  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}
