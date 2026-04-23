import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { RuntimeIPC } from "../../src/ipc/runtime";

describe("RuntimeIPC", () => {
  let root: string;
  let ipc: RuntimeIPC;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mnemonic-ipc-"));
    ipc = new RuntimeIPC(join(root, "status.json"), join(root, "events.ndjson"));
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
    expect(status.processedSessions).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]!.sessionId).toBe("session-1");
  });
});
