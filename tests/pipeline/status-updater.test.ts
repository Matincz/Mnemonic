import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, ParsedSession } from "../../src/types";

const hasEmbeddingProviderMock = mock(() => false);
const embedTextsMock = mock(async (): Promise<Array<{ model: string; values: number[] }>> => []);

beforeEach(() => {
  mock.restore();
  hasEmbeddingProviderMock.mockClear();
  embedTextsMock.mockClear();
  hasEmbeddingProviderMock.mockImplementation(() => false);
  mock.module("../../src/embeddings", () => ({
    hasEmbeddingProvider: hasEmbeddingProviderMock,
    embedTexts: embedTextsMock,
  }));
});

function makeSession(messages: ParsedSession["messages"], overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    id: "session-current",
    source: "codex",
    timestamp: new Date("2026-05-03T00:00:00.000Z"),
    project: "workspace-iot",
    rawPath: "/tmp/session.jsonl",
    messages,
    ...overrides,
  };
}

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "procedural",
    title: "Validate daemon replay flow",
    summary: "Replay flow should pass after retry fix",
    details: "Ensure daemon replay can pass all integration checks in nightly automation.",
    tags: ["daemon", "replay"],
    project: "iot",
    sourceSessionId: "session-old",
    sourceAgent: "codex",
    createdAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
    status: "proposed",
    sourceSessionIds: ["session-old"],
    supportingMemoryIds: [],
    salience: 0.7,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

describe("propagateVerificationSignals", () => {
  it("upgrades related proposed memories to verified when test pass signals are present", async () => {
    const current = makeMemory("current-1", {
      status: "observed",
      sourceSessionId: "session-current",
      sourceSessionIds: ["session-current"],
      createdAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
    });

    const shouldUpgrade = makeMemory("proposed-1");
    const shouldNotUpgrade = makeMemory("proposed-2", {
      title: "Unrelated UI color tweak",
      summary: "Adjust button shade for onboarding page",
      details: "Choose a neutral hover shade for the onboarding action button.",
    });

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-1";
    const { propagateVerificationSignals } = await import(modulePath);
    await propagateVerificationSignals(
      makeSession([
        { role: "assistant", content: "✅ all tests pass after replay fix" },
      ]),
      [current],
      {
        config: {} as never,
        listAll: () => [shouldUpgrade, shouldNotUpgrade],
        saveMemories,
      } as never,
    );

    expect(saveMemories).toHaveBeenCalledTimes(1);
    const updated = saveMemories.mock.calls[0]?.[0] as Memory[];
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe("proposed-1");
    expect(updated[0]?.status).toBe("verified");
    expect(updated[0]?.linkedMemoryIds).toContain("current-1");
  });

  it("does nothing when session has no verification signal", async () => {
    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-2";
    const { propagateVerificationSignals } = await import(modulePath);
    await propagateVerificationSignals(
      makeSession([
        { role: "assistant", content: "I explored some ideas and took notes." },
      ]),
      [makeMemory("current-1", { status: "observed" })],
      {
        config: {} as never,
        listAll: () => [makeMemory("proposed-1")],
        saveMemories,
      } as never,
    );

    expect(saveMemories).not.toHaveBeenCalled();
  });

  it("does not upgrade proposed memories older than seven days", async () => {
    const stale = makeMemory("stale-proposed", {
      createdAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    });

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-3";
    const { propagateVerificationSignals } = await import(modulePath);
    await propagateVerificationSignals(
      makeSession([
        { role: "assistant", content: "Tool run succeeded: command bun test, exit_code: 0" },
      ]),
      [makeMemory("current-1", { status: "observed" })],
      {
        config: {} as never,
        listAll: () => [stale],
        saveMemories,
      } as never,
    );

    expect(saveMemories).not.toHaveBeenCalled();
  });
});
