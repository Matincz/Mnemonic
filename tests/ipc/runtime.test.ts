import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { RuntimeIPC } from "../../src/ipc/runtime";

describe("RuntimeIPC", () => {
  let root: string;
  let ipc: RuntimeIPC;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mnemonic-ipc-"));
    ipc = new RuntimeIPC(join(root, "status.json"), join(root, "events.ndjson"), root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("persists status and events", () => {
    ipc.reset();
    ipc.writeStatus({ state: "watching", message: "Ready", processedSessions: 2 });
    ipc.emit({
      kind: "session-processed",
      timestamp: "2026-04-16T00:00:00.000Z",
      message: "Processed codex session",
      sessionId: "session-1",
      source: "codex",
      memoryCount: 4,
    });

    const status = ipc.readStatus();
    const events = ipc.readRecentEvents(5);

    expect(status.state).toBe("watching");
    expect(status.pid).toBe(process.pid);
    expect(status.heartbeatAt).toBeDefined();
    expect(status.processedSessions).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]!.sessionId).toBe("session-1");
  });

  it("reports active legacy status without pid as stopped", () => {
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({
        state: "watching",
        updatedAt: new Date().toISOString(),
        message: "Watching",
        processedSessions: 3,
      }),
    );

    const status = ipc.readStatus();
    expect(status.state).toBe("stopped");
    expect(status.message).toBe("Daemon process is not running.");
  });

  it("reports stale heartbeat as stopped", () => {
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({
        state: "watching",
        updatedAt: "1970-01-01T00:00:00.000Z",
        heartbeatAt: "1970-01-01T00:00:00.000Z",
        message: "Watching",
        processedSessions: 3,
        pid: process.pid,
      }),
    );

    const status = ipc.readStatus();
    expect(status.state).toBe("stopped");
    expect(status.message).toBe("Daemon heartbeat is stale.");
  });
});
