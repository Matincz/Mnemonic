import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Memory, ParsedSession } from "../../src/types";

const hasEmbeddingProviderMock = mock(() => false);
const embedTextsMock = mock(async (input: string[]): Promise<Array<{ model: string; values: number[] }>> =>
  input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })),
);

beforeEach(() => {
  mock.restore();
  hasEmbeddingProviderMock.mockClear();
  embedTextsMock.mockClear();
  hasEmbeddingProviderMock.mockImplementation(() => false);
  embedTextsMock.mockImplementation(async (input: string[]) =>
    input.map((text) => ({ model: "test-embedding", values: vectorOf(text) })),
  );
  mock.module("../../src/embeddings", () => ({
    hasEmbeddingProvider: hasEmbeddingProviderMock,
    embedTexts: embedTextsMock,
  }));
});

function vectorOf(text: string): number[] {
  const normalized = text.toLowerCase();
  if (normalized.includes("validate daemon replay flow")) return [1, 0, 0];
  if (normalized.includes("unrelated ui color")) return [0, 1, 0];
  return [0.98, 0.1, 0];
}

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
        { role: "assistant", content: "bun test exit_code: 0 all tests pass after replay fix" },
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

  it("upgrades related observed memories to verified when test pass signals are present", async () => {
    const current = makeMemory("current-observed", {
      status: "observed",
      sourceSessionId: "session-current",
      sourceSessionIds: ["session-current"],
      createdAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
    });
    const observed = makeMemory("observed-1", { status: "observed" });
    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-observed";
    const { propagateVerificationSignals } = await import(modulePath);

    await propagateVerificationSignals(
      makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass after replay fix" }]),
      [current],
      {
        config: {} as never,
        listAll: () => [observed],
        saveMemories,
      } as never,
    );

    const updated = saveMemories.mock.calls[0]?.[0] as Memory[];
    expect(updated[0]?.id).toBe("observed-1");
    expect(updated[0]?.status).toBe("verified");
  });

  it("does not rewrite memories that are already verified", async () => {
    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-verified";
    const { propagateVerificationSignals } = await import(modulePath);

    await propagateVerificationSignals(
      makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass" }]),
      [makeMemory("current-1", { status: "observed" })],
      {
        config: {} as never,
        listAll: () => [makeMemory("verified-1", { status: "verified" })],
        saveMemories,
      } as never,
    );

    expect(saveMemories).not.toHaveBeenCalled();
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

  it("allows reset reprocessing to verify historical proposed memories within the session window", async () => {
    const current = makeMemory("current-1", {
      status: "observed",
      createdAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    });
    const candidate = makeMemory("proposed-reset", {
      createdAt: new Date("2026-04-15T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-15T00:00:00.000Z").toISOString(),
    });

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-4";
    const { propagateVerificationSignals } = await import(modulePath);
    await propagateVerificationSignals(
      makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass" }], {
        timestamp: new Date("2026-04-20T00:00:00.000Z"),
      }),
      [current],
      {
        config: {} as never,
        listAll: () => [candidate],
        saveMemories,
      } as never,
    );

    expect(saveMemories).toHaveBeenCalledTimes(1);
  });

  it("does not allow old sessions to verify memories from more than the clock-skew window ahead", async () => {
    const candidate = makeMemory("future-proposed", {
      createdAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    });

    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-5";
    const { propagateVerificationSignals } = await import(modulePath);
    await propagateVerificationSignals(
      makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass" }], {
        timestamp: new Date("2026-04-15T00:00:00.000Z"),
      }),
      [makeMemory("current-1", { status: "observed" })],
      {
        config: {} as never,
        listAll: () => [candidate],
        saveMemories,
      } as never,
    );

    expect(saveMemories).not.toHaveBeenCalled();
  });

  it("rejects unanchored or weak verification language", async () => {
    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-6";
    const { propagateVerificationSignals } = await import(modulePath);

    for (const content of ["plan to deploy next week", "git merge conflict resolved", "will deploy tomorrow"]) {
      await propagateVerificationSignals(
        makeSession([{ role: "assistant", content }]),
        [makeMemory("current-1", { status: "observed" })],
        {
          config: {} as never,
          listAll: () => [makeMemory(`candidate-${content}`)],
          saveMemories,
        } as never,
      );
    }

    expect(saveMemories).not.toHaveBeenCalled();
  });

  it("reuses similarity vector cache across repeated propagation runs", async () => {
    hasEmbeddingProviderMock.mockImplementation(() => true);

    const { resetSimilarityVectorCacheForTests } = await import("../../src/pipeline/similarity");
    resetSimilarityVectorCacheForTests();
    const candidate = makeMemory("proposed-cache");
    const current = makeMemory("current-cache", { status: "observed" });
    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-7";
    const { propagateVerificationSignals } = await import(modulePath);
    const storage = {
      config: { embedding: { provider: "api", model: "test-embedding" } } as never,
      listAll: () => [candidate],
      saveMemories,
    } as never;

    await propagateVerificationSignals(makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass" }]), [current], storage);
    await propagateVerificationSignals(makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass" }]), [current], storage);

    expect(embedTextsMock).toHaveBeenCalledTimes(1);
  });

  it("can disable verification propagation with an environment flag", async () => {
    process.env.MNEMONIC_DISABLE_VERIFICATION_PROPAGATION = "1";
    const saveMemories = mock(async (_memories: Memory[]) => {});
    const modulePath = "../../src/pipeline/status-updater.ts?spec=status-updater-test-8";
    const { propagateVerificationSignals } = await import(modulePath);

    try {
      await propagateVerificationSignals(
        makeSession([{ role: "assistant", content: "bun test exit_code: 0 all tests pass" }]),
        [makeMemory("current-1", { status: "observed" })],
        {
          config: {} as never,
          listAll: () => [makeMemory("proposed-1")],
          saveMemories,
        } as never,
      );
    } finally {
      delete process.env.MNEMONIC_DISABLE_VERIFICATION_PROPAGATION;
    }

    expect(saveMemories).not.toHaveBeenCalled();
  });
});
