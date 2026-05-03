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
  pid?: number;
  startedAt?: string;
  heartbeatAt?: string;
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

const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
const activeStates = new Set<RuntimeStatus["state"]>(["starting", "backfill", "watching", "error"]);

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
    const updatedAt = new Date().toISOString();
    const merged: RuntimeStatus = {
      ...current,
      ...next,
      updatedAt,
    };
    if (activeStates.has(merged.state)) {
      merged.pid = process.pid;
      merged.startedAt = current.pid === process.pid && current.startedAt ? current.startedAt : (merged.startedAt ?? updatedAt);
      merged.heartbeatAt = updatedAt;
    } else {
      delete merged.pid;
      delete merged.startedAt;
      delete merged.heartbeatAt;
    }
    writeFileSync(this.statusPath, JSON.stringify(merged, null, 2) + "\n");
    return merged;
  }

  heartbeat() {
    const current = this.readStatus();
    if (!activeStates.has(current.state)) {
      return current;
    }
    return this.writeStatus({
      state: current.state,
      message: current.message,
    });
  }

  readStatus(): RuntimeStatus {
    if (!existsSync(this.statusPath)) {
      return defaultStatus;
    }

    try {
      const status = {
        ...defaultStatus,
        ...JSON.parse(readFileSync(this.statusPath, "utf8")),
      } as RuntimeStatus;
      return this.withLiveness(status);
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

  private withLiveness(status: RuntimeStatus): RuntimeStatus {
    if (!activeStates.has(status.state)) {
      return status;
    }

    if (!status.pid || !isProcessAlive(status.pid)) {
      return markStale(status, "Daemon process is not running.");
    }

    const heartbeatTime = Date.parse(status.heartbeatAt ?? status.updatedAt);
    if (!Number.isFinite(heartbeatTime) || Date.now() - heartbeatTime > HEARTBEAT_TTL_MS) {
      return markStale(status, "Daemon heartbeat is stale.");
    }

    return status;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function markStale(status: RuntimeStatus, message: string): RuntimeStatus {
  return {
    ...status,
    state: "stopped",
    message,
    lastError: message,
  };
}
