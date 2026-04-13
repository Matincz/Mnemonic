import { config } from "../config";
import { parsers, AmpParser } from "../parsers";
import type { Storage } from "../storage";
import { processSession } from "../pipeline";
import { DebouncedWatcher } from "./fs-watcher";
import { shouldProcess, markDone } from "./state";

export class WatcherOrchestrator {
  private watcher = new DebouncedWatcher();
  private processing = new Set<string>();

  constructor(private storage: Storage) {}

  start() {
    console.log("[watcher] Starting file watchers...");

    // Watch Codex sessions
    this.watcher.watch(config.sources.codex, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("codex", path);
    });

    // Watch Claude Code sessions
    this.watcher.watch(config.sources.claudeCode, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("claude-code", path);
    });

    // Watch Gemini sessions
    this.watcher.watch(config.sources.gemini, (path) => {
      if (path.endsWith(".json")) this.handleFile("gemini", path);
    });

    // Watch OpenCode database
    this.watcher.watch(config.sources.opencode.replace("/opencode.db", ""), (path) => {
      if (path.endsWith("opencode.db")) this.handleFile("opencode", path);
    });

    // Watch OpenClaw sessions
    this.watcher.watch(config.sources.openclaw, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("openclaw", path);
    });

    console.log("[watcher] All watchers active.");
  }

  /** Periodically poll Amp threads (no fs watch available) */
  async pollAmp() {
    const ampParser = parsers.amp as AmpParser;
    const threadIds = await ampParser.listRecentThreads();
    for (const tid of threadIds) {
      const key = `amp:${tid}`;
      if (this.storage.isProcessed(key, tid)) continue;
      const session = await ampParser.parse(tid);
      if (!session) continue;
      await processSession(session, this.storage);
      this.storage.markProcessed(key, tid, session.id);
    }
  }

  private async handleFile(parserName: string, filePath: string) {
    if (this.processing.has(filePath)) return;
    if (!shouldProcess(filePath, this.storage)) return;

    this.processing.add(filePath);
    try {
      const parser = parsers[parserName];
      if (!parser) return;

      console.log(`[watcher] New/changed: ${filePath} (${parserName})`);
      const session = await parser.parse(filePath);
      if (!session) return;

      await processSession(session, this.storage);
      markDone(filePath, session.id, this.storage);
    } catch (err) {
      console.error(`[watcher] Error processing ${filePath}:`, err);
    } finally {
      this.processing.delete(filePath);
    }
  }

  stop() {
    this.watcher.close();
  }
}
