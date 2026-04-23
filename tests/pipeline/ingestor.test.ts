import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, ParsedSession, MemorySearchResult } from "../../src/types";

const llmGenerateJSONMock = mock(async (_prompt: string): Promise<unknown> => []);

beforeEach(() => {
  llmGenerateJSONMock.mockClear();
  mock.module("../../src/llm", () => ({
    llmGenerateJSON: llmGenerateJSONMock,
  }));
});

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    id: "session-1",
    source: "codex",
    timestamp: new Date("2026-04-21T01:02:03.000Z"),
    project: "workspace-iot",
    rawPath: "/tmp/session.jsonl",
    messages: [
      { role: "user", content: "Fix the sync dedup issue" },
      { role: "assistant", content: "Applied the dedup change and verified it" },
    ],
    ...overrides,
  };
}

function makeExistingMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: "Zeekr to InfluxDB Sync Execution",
    summary: "Zeekr sync completed and pushed data to InfluxDB.",
    details: "A recurring sync run completed successfully.",
    tags: ["zeekr", "sync"],
    project: "iot",
    sourceSessionId: "older-session",
    sourceAgent: "amp",
    createdAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["older-session"],
    supportingMemoryIds: [],
    salience: 0.6,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

function hit(memory: Memory): MemorySearchResult {
  return {
    memory,
    score: 0.9,
    reasons: ["keyword"],
  };
}

describe("ingest", () => {
  it("normalizes project names and preserves the session timestamp", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        layer: "procedural",
        title: "Reset the daemon",
        summary: "Restart the watcher and verify the backlog drains.",
        details: "Run restart, then confirm the queue depth returns to zero.",
        tags: ["daemon", "restart"],
        status: "verified",
        salience: 0.72,
      },
    ]);

    const { ingest } = await import("../../src/pipeline/ingestor");
    const [memory] = await ingest(makeSession(), {
      findRelatedMemoriesBatch: async () => [[]],
    } as never);

    expect(memory?.project).toBe("iot");
    expect(memory?.createdAt).toBe("2026-04-21T01:02:03.000Z");
    expect(memory?.updatedAt).toBe("2026-04-21T01:02:03.000Z");
    expect(memory?.status).toBe("verified");
  });

  it("skips memories that match existing same-layer memories with overlapping tags", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        layer: "semantic",
        title: "Zeekr to InfluxDB Sync Execution",
        summary: "Zeekr sync completed and pushed data to InfluxDB.",
        details: "Another routine sync run completed.",
        tags: ["zeekr", "sync"],
        salience: 0.55,
      },
      {
        layer: "procedural",
        title: "Replay a failed sync",
        summary: "Use the replay command when a sync genuinely fails.",
        details: "Invoke the replay subcommand with the failed batch id.",
        tags: ["zeekr", "replay"],
        salience: 0.7,
      },
    ]);

    const { ingest } = await import("../../src/pipeline/ingestor");
    const memories = await ingest(makeSession(), {
      findRelatedMemoriesBatch: async () => [
        [hit(makeExistingMemory("existing-1"))],
        [],
      ],
    } as never);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.title).toBe("Replay a failed sync");
    expect(memories[0]?.project).toBe("iot");
  });

  it("upgrades an existing proposed memory when a duplicate arrives with verified evidence", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        layer: "procedural",
        title: "Reset the daemon",
        summary: "Restart the watcher and verify the backlog drains.",
        details: "Run restart, then confirm the queue depth returns to zero after the fix.",
        tags: ["daemon", "restart"],
        status: "verified",
        salience: 0.9,
      },
    ]);

    const existing = makeExistingMemory("existing-proposed", {
      layer: "procedural",
      title: "Reset the daemon",
      summary: "Restart the watcher.",
      details: "Restart the watcher.",
      tags: ["daemon"],
      status: "proposed",
      salience: 0.45,
      sourceSessionIds: ["older-session"],
    });

    const { ingest } = await import("../../src/pipeline/ingestor");
    const memories = await ingest(makeSession(), {
      findRelatedMemoriesBatch: async () => [[hit(existing)]],
    } as never);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.id).toBe("existing-proposed");
    expect(memories[0]?.status).toBe("verified");
    expect(memories[0]?.sourceSessionId).toBe("session-1");
    expect(memories[0]?.sourceSessionIds).toEqual(["older-session", "session-1"]);
    expect(memories[0]?.supportingMemoryIds).toHaveLength(1);
    expect(memories[0]?.salience).toBe(0.9);
    expect(memories[0]?.details).toContain("queue depth returns to zero");
  });
});
