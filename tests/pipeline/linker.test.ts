import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, MemorySearchResult } from "../../src/types";

const llmGenerateJSONMock = mock(async (_prompt: string): Promise<unknown> => []);

beforeEach(() => {
  mock.restore();
  llmGenerateJSONMock.mockClear();
  mock.module("../../src/llm", () => ({
    llmGenerateJSON: llmGenerateJSONMock,
  }));
});

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: ["memory"],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date("2026-05-02T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-05-02T00:00:00.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.7,
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

describe("linkBatch contradiction handling", () => {
  it("adds heuristic contradictions when the LLM omits obvious polarity conflicts", async () => {
    const incoming = makeMemory("incoming-heuristic", {
      title: "Use HMAC tokens instead of SHA tokens",
      summary: "Use HMAC-SHA-512 instead of SHA-256 for tokens.",
      details: "Replace the old SHA-256 token rule with HMAC-SHA-512.",
      createdAt: new Date("2026-05-04T00:00:00.000Z").toISOString(),
    });
    const old = makeMemory("old-heuristic", {
      title: "Use SHA tokens",
      summary: "Use SHA-256 for tokens.",
      details: "The token rule uses SHA-256.",
      createdAt: new Date("2026-05-02T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-05-02T00:00:00.000Z").toISOString(),
    });

    llmGenerateJSONMock.mockImplementation(async () => [
      {
        memory_id: "incoming-heuristic",
        linked_ids: [],
        contradicts_ids: [],
        explanation: "missed contradiction",
      },
    ]);

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/linker.ts?spec=linker-test-heuristic";
    const { linkBatch } = await import(modulePath);
    const result = await linkBatch(
      [incoming],
      {
        findRelatedMemoriesBatch: async () => [[hit(old)]],
        saveMemories,
      } as never,
    );

    expect(result[0]?.contradicts).toEqual(["old-heuristic"]);
    expect(saveMemories).toHaveBeenCalledTimes(1);
  });

  it("marks contradicted older memories as superseded and persists them", async () => {
    const incoming = makeMemory("incoming-1", {
      createdAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
      salience: 0.9,
    });
    const old = makeMemory("old-1", {
      createdAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
      salience: 0.6,
      status: "observed",
    });

    llmGenerateJSONMock.mockImplementation(async () => [
      {
        memory_id: "incoming-1",
        linked_ids: [],
        contradicts_ids: ["old-1"],
        explanation: "new evidence supersedes prior assumption",
      },
    ]);

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/linker.ts?spec=linker-test-1";
    const { linkBatch } = await import(modulePath);
    const result = await linkBatch(
      [incoming],
      {
        findRelatedMemoriesBatch: async () => [[hit(old)]],
        saveMemories,
      } as never,
    );

    expect(result[0]?.contradicts).toEqual(["old-1"]);
    expect(saveMemories).toHaveBeenCalledTimes(1);
    const persisted = saveMemories.mock.calls[0]?.[0] as Memory[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.id).toBe("old-1");
    expect(persisted[0]?.status).toBe("superseded");
    expect(persisted[0]?.updatedAt).toBe(incoming.createdAt);
    expect(persisted[0]?.salience).toBeCloseTo(0.42, 6);
    expect(persisted[0]?.linkedMemoryIds).toContain("incoming-1");
  });

  it("does not supersede when incoming evidence is older or weaker", async () => {
    const incoming = makeMemory("incoming-1", {
      createdAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
      salience: 0.5,
    });
    const old = makeMemory("old-1", {
      updatedAt: new Date("2026-05-02T00:00:00.000Z").toISOString(),
      salience: 0.8,
      status: "observed",
    });

    llmGenerateJSONMock.mockImplementation(async () => [
      {
        memory_id: "incoming-1",
        linked_ids: [],
        contradicts_ids: ["old-1"],
        explanation: "possible contradiction",
      },
    ]);

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/linker.ts?spec=linker-test-2";
    const { linkBatch } = await import(modulePath);
    const result = await linkBatch(
      [incoming],
      {
        findRelatedMemoriesBatch: async () => [[hit(old)]],
        saveMemories,
      } as never,
    );

    expect(result[0]?.contradicts).toEqual(["old-1"]);
    expect(saveMemories).not.toHaveBeenCalled();
  });
});
