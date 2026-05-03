import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, ParsedSession, MemorySearchResult } from "../../src/types";

const llmGenerateJSONMock = mock(async (_prompt: string): Promise<unknown> => []);
const hasEmbeddingProviderMock = mock(() => true);
const embedTextsMock = mock(async (input: string[]) => input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })));

beforeEach(() => {
  llmGenerateJSONMock.mockClear();
  hasEmbeddingProviderMock.mockClear();
  embedTextsMock.mockClear();
  hasEmbeddingProviderMock.mockImplementation(() => true);
  embedTextsMock.mockImplementation(async (input: string[]) =>
    input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })),
  );
  mock.module("../../src/llm", () => ({
    llmGenerateJSON: llmGenerateJSONMock,
  }));
  mock.module("../../src/embeddings", () => ({
    hasEmbeddingProvider: hasEmbeddingProviderMock,
    embedTexts: embedTextsMock,
  }));
});

afterAll(() => {
  mock.restore();
});

function vectorOf(text: string): number[] {
  const normalized = text.toLowerCase();
  if (normalized.includes("deployment procedure for iot")) return [0.92, 0.28, 0];
  if (normalized.includes("deployment procedure for code")) return [0.2, 0.98, 0];
  if (normalized.includes("jwt refresh handling")) return [1, 0, 0];
  if (normalized.includes("auth refresh token flow")) return [0.97, 0.2, 0];
  if (normalized.includes("deployment procedure")) return [0.94, 0.25, 0];
  if (normalized.includes("auth token rotation policy")) return [0.93, 0.3, 0];
  if (normalized.includes("auth token rotation procedure")) return [0.92, 0.31, 0];
  if (normalized.includes("reset the daemon")) return [0.9, 0.35, 0];
  if (normalized.includes("restart the watcher")) return [0.89, 0.34, 0];
  if (normalized.includes("replay a failed sync")) return [0, 1, 0];
  if (normalized.includes("zeekr")) return [0, 0.95, 0.2];
  return [0.2, 0.2, 0.9];
}

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

  it("deduplicates semantically similar memories in the same project", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        layer: "semantic",
        title: "Auth refresh token flow",
        summary: "Handle refresh token renewal and persist the updated JWT pair.",
        details: "The refresh flow now rotates the JWT pair and stores it for retry paths.",
        tags: ["auth", "jwt"],
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
        [
          hit(
            makeExistingMemory("existing-1", {
              title: "JWT refresh handling",
              summary: "Handle refresh token renewal and persist the updated JWT pair.",
              tags: ["auth"],
              project: "iot",
            }),
          ),
        ],
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
    expect(memories[0]?.sourceSessionId).toBe("older-session");
    expect(memories[0]?.sourceAgent).toBe("amp");
    expect(memories[0]?.sourceSessionIds).toEqual(["older-session", "session-1"]);
    expect(memories[0]?.supportingMemoryIds).toHaveLength(1);
    expect(memories[0]?.salience).toBe(0.9);
    expect(memories[0]?.details).toContain("queue depth returns to zero");
  });

  it("does not merge cross-project memories when title cosine is below the hard threshold", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        layer: "semantic",
        title: "Deployment procedure for IoT",
        summary: "Deploys the service to production after checks pass.",
        details: "Run tests, build image, deploy through CI pipeline.",
        tags: ["deploy"],
        salience: 0.6,
      },
    ]);

    const { ingest } = await import("../../src/pipeline/ingestor");
    const memories = await ingest(makeSession(), {
      findRelatedMemoriesBatch: async () => [
        [
          hit(
            makeExistingMemory("existing-cross-project", {
              title: "Deployment procedure for Code",
              summary: "Deploys another system in a separate project.",
              project: "code",
              tags: ["deploy"],
            }),
          ),
        ],
      ],
    } as never);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.id).not.toBe("existing-cross-project");
    expect(memories[0]?.title).toBe("Deployment procedure for IoT");
  });

  it("links very similar cross-layer memories instead of merging them", async () => {
    llmGenerateJSONMock.mockImplementation(async () => [
      {
        layer: "semantic",
        title: "Auth token rotation policy",
        summary: "Rotate tokens every 30 days with audit logging.",
        details: "Policy details and audit evidence.",
        tags: ["auth", "rotation"],
        salience: 0.66,
      },
    ]);

    const { ingest } = await import("../../src/pipeline/ingestor");
    const memories = await ingest(makeSession(), {
      findRelatedMemoriesBatch: async () => [
        [
          hit(
            makeExistingMemory("existing-cross-layer", {
              layer: "procedural",
              title: "Auth token rotation procedure",
              summary: "Rotate tokens every 30 days with audit logging.",
            }),
          ),
        ],
      ],
    } as never);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.id).not.toBe("existing-cross-layer");
    expect(memories[0]?.linkedMemoryIds).toContain("existing-cross-layer");
  });
});
