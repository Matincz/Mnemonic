import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, MemorySearchResult } from "../../src/types";

const llmGenerateJSONMock = mock(async (_prompt: string): Promise<unknown> => []);

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
    createdAt: new Date("2026-04-16T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-16T00:00:00.000Z").toISOString(),
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

describe("consolidate", () => {
  beforeEach(() => {
    llmGenerateJSONMock.mockClear();
    mock.module("../../src/llm", () => ({
      llmGenerateJSON: llmGenerateJSONMock,
    }));
  });

  it("batches consolidation decisions into a single llm call", async () => {
    const durable = makeMemory("durable-1", {
      layer: "procedural",
      title: "Auth rotation procedure",
      summary: "Existing durable auth guidance",
    });

    llmGenerateJSONMock.mockImplementation(async (_prompt: string): Promise<unknown> => [
      {
        memory_id: "new-1",
        action: "update-existing",
        target_id: "durable-1",
        layer: "procedural",
        title: "Auth rotation procedure",
        summary: "Merged durable auth guidance",
        details: "Updated with the latest refresh rotation fix.",
        tags: ["auth", "rotation"],
        linked_ids: ["durable-1"],
        salience: 0.85,
      },
    ]);

    const { consolidate } = await import("../../src/pipeline/consolidator");

    const findRelatedMemoriesBatch = mock(async () => [[hit(durable)], []]);

    const results = await consolidate(
      [
        makeMemory("new-1", {
          title: "Refresh token fix",
          summary: "Rotate refresh token after exchange",
          tags: ["auth"],
        }),
        makeMemory("new-2", {
          title: "Unrelated note",
          summary: "Should not produce a merge",
        }),
      ],
      {
        findRelatedMemoriesBatch,
        getMemory: (id: string) => (id === durable.id ? durable : null),
      } as never,
    );

    const calls = llmGenerateJSONMock.mock.calls as Array<[string]>;
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain("MEMORY new-1");
    expect(String(calls[0]?.[0])).not.toContain("MEMORY new-2");
    expect(findRelatedMemoriesBatch).toHaveBeenCalledWith(expect.any(Array), {
      limit: 12,
      layers: ["semantic", "procedural", "insight"],
    });

    const updated = results.find((memory) => memory.id === durable.id);
    expect(updated?.summary).toBe("Merged durable auth guidance");
    expect(updated?.linkedMemoryIds).toContain("new-1");
  });

  it("merges multiple updates targeting the same memory", async () => {
    const existingMemory: Memory = {
      id: "existing-1",
      layer: "semantic",
      title: "Original Title",
      summary: "Original summary",
      details: "Original details that are quite long",
      tags: ["tag-a"],
      project: "test",
      sourceSessionId: "session-0",
      sourceAgent: "codex",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "observed",
      sourceSessionIds: ["session-0"],
      supportingMemoryIds: [],
      salience: 0.5,
      linkedMemoryIds: [],
      contradicts: [],
    };

    const newMemory1: Memory = {
      id: "new-1",
      layer: "episodic",
      title: "New Memory 1",
      summary: "First new finding",
      details: "Details from first memory",
      tags: ["tag-b"],
      project: "test",
      sourceSessionId: "session-1",
      sourceAgent: "codex",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "observed",
      sourceSessionIds: ["session-1"],
      supportingMemoryIds: [],
      salience: 0.6,
      linkedMemoryIds: [],
      contradicts: [],
    };

    const newMemory2: Memory = {
      id: "new-2",
      layer: "episodic",
      title: "New Memory 2",
      summary: "Second new finding",
      details: "Details from second memory",
      tags: ["tag-c"],
      project: "test",
      sourceSessionId: "session-1",
      sourceAgent: "codex",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "observed",
      sourceSessionIds: ["session-1"],
      supportingMemoryIds: [],
      salience: 0.8,
      linkedMemoryIds: [],
      contradicts: ["contradiction-1"],
    };

    llmGenerateJSONMock.mockImplementation(async (_prompt: string): Promise<unknown> => [
      {
        memory_id: "new-1",
        action: "update-existing",
        target_id: "existing-1",
        layer: "semantic",
        title: "Updated Title v1",
        summary: "Updated summary v1",
        details: "Short v1",
        tags: ["tag-d"],
        salience: 0.7,
        linked_ids: [],
        reason: "first update",
      },
      {
        memory_id: "new-2",
        action: "update-existing",
        target_id: "existing-1",
        layer: "semantic",
        title: "Updated Title v2",
        summary: "Updated summary v2",
        details: "Much longer details from v2 update that should be preserved",
        tags: ["tag-e"],
        salience: 0.9,
        linked_ids: [],
        reason: "second update",
      },
    ]);

    const { consolidate } = await import("../../src/pipeline/consolidator");

    const result = await consolidate(
      [newMemory1, newMemory2],
      {
        findRelatedMemoriesBatch: mock(async () => [
          [{ memory: existingMemory, score: 0.9, reasons: ["keyword"] }],
          [{ memory: existingMemory, score: 0.85, reasons: ["keyword"] }],
        ]),
        getMemory: mock((id: string) => (id === "existing-1" ? existingMemory : null)),
      } as never,
    );

    const merged = result.find((memory) => memory.id === "existing-1");
    expect(merged).toBeDefined();

    expect(merged!.tags).toContain("tag-a");
    expect(merged!.tags).toContain("tag-b");
    expect(merged!.tags).toContain("tag-c");
    expect(merged!.tags).toContain("tag-d");
    expect(merged!.tags).toContain("tag-e");

    expect(merged!.details).toBe("Much longer details from v2 update that should be preserved");
    expect(merged!.salience).toBe(0.9);
    expect(merged!.linkedMemoryIds).toContain("new-1");
    expect(merged!.linkedMemoryIds).toContain("new-2");
    expect(merged!.contradicts).toContain("contradiction-1");
  });

  it("ignores episodic consolidation outputs instead of failing the session", async () => {
    const episodic = makeMemory("episodic-1", {
      layer: "episodic",
      title: "Temporary debugging step",
    });
    const durable = makeMemory("durable-1", {
      layer: "semantic",
      title: "Durable reference",
    });

    llmGenerateJSONMock.mockImplementation(async (_prompt: string): Promise<unknown> => [
      {
        memory_id: "episodic-1",
        action: "create-synthesis",
        layer: "episodic",
        title: "Should be ignored",
        summary: "Transient event",
        details: "This is not durable knowledge.",
        reason: "bad model output",
      },
    ]);

    const { consolidate } = await import("../../src/pipeline/consolidator");

    const results = await consolidate(
      [episodic],
      {
        findRelatedMemoriesBatch: mock(async () => [[hit(durable)]]),
        getMemory: mock(() => null),
      } as never,
    );

    expect(results).toEqual([episodic]);
  });
});
