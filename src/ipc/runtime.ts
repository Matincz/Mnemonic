import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { loadConfig } from "../config";

export interface RuntimeEvent {
  kind: "session-processed" | "session-skipped" | "session-error" | "daemon-status";
  timestamp: string;
  message: string;
  sessionId?: string;
  source?: string;
  memoryCount?: number;
  details?: string;
}

export interface RuntimeStatus {
  state: "starting" | "backfill" | "watching" | "idle" | "error" | "stopped";
  updatedAt: string;
  message: string;
  processedSessions: number;
  lastSessionId?: string;
  lastSource?: string;
  lastMemoryCount?: number;
  lastError?: string;
}

const defaultStatus: RuntimeStatus = {
  state: "idle",
  updatedAt: new Date(0).toISOString(),
  message: "Daemon not started.",
  processedSessions: 0,
};

export class RuntimeIPC {
  constructor(
    private statusPath = loadConfig().ipcStatusPath,
    private eventsPath = loadConfig().ipcEventsPath,
    ipcDir = loadConfig().ipcDir,
  ) {
    mkdirSync(ipcDir, { recursive: true });
  }

  reset() {
    if (existsSync(this.eventsPath)) {
      rmSync(this.eventsPath, { force: true });
    }
    this.writeStatus(defaultStatus);
  }

  writeStatus(next: Partial<RuntimeStatus>) {
    const current = this.readStatus();
    const merged: RuntimeStatus = {
      ...current,
      ...next,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(this.statusPath, JSON.stringify(merged, null, 2) + "\n");
    return merged;
  }

  readStatus(): RuntimeStatus {
    if (!existsSync(this.statusPath)) {
      return defaultStatus;
    }

    try {
      return {
        ...defaultStatus,
        ...JSON.parse(readFileSync(this.statusPath, "utf8")),
      } as RuntimeStatus;
    } catch {
      return defaultStatus;
    }
  }

  emit(event: RuntimeEvent) {
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`);
  }

  readRecentEvents(limit = 20): RuntimeEvent[] {
    if (!existsSync(this.eventsPath)) {
      return [];
    }

    const lines = readFileSync(this.eventsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);

    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as RuntimeEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is RuntimeEvent => event !== null)
      .reverse();
  }
}
