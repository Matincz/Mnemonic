import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { PipelineResult, ParsedSession } from "../../src/types";

const processSessionMock = mock(async (session: ParsedSession): Promise<PipelineResult> => ({
  sessionId: session.id,
  stage: "done",
  memories: [],
  skipped: false,
}));

mock.module("../../src/pipeline", () => ({
  processSession: processSessionMock,
}));

function makeSession(id: string, timestamp: string): ParsedSession {
  return {
    id,
    source: "amp",
    timestamp: new Date(timestamp),
    rawPath: `amp:${id}`,
    messages: [
      { role: "user", content: `question ${id}` },
      { role: "assistant", content: `answer ${id}` },
    ],
  };
}

function makeStorage() {
  return {
    isProcessed: mock(() => false),
    recordProcessedSession: mock(async () => {}),
    db: {
      clearCheckpoints: mock(() => {}),
    },
  } as never;
}

function makeWiki() {
  return {
    engine: {},
    index: {},
    log: {},
    registry: {},
  } as never;
}

beforeEach(() => {
  processSessionMock.mockClear();
  processSessionMock.mockImplementation(async (session: ParsedSession): Promise<PipelineResult> => ({
    sessionId: session.id,
    stage: "done",
    memories: [],
    skipped: false,
  }));
});

describe("WatcherOrchestrator", () => {
  it("continues polling Amp sessions after one session fails", async () => {
    const { WatcherOrchestrator } = await import("../../src/watcher");
    const storage = makeStorage();
    const sessions = [
      makeSession("amp-first", "2026-04-20T00:00:00.000Z"),
      makeSession("amp-second", "2026-04-20T01:00:00.000Z"),
    ];

    processSessionMock.mockImplementation(async (session: ParsedSession): Promise<PipelineResult> => {
      if (session.id === "amp-first") {
        throw new Error("first failed");
      }
      return {
        sessionId: session.id,
        stage: "done",
        memories: [],
        skipped: false,
      };
    });

    const orchestrator = new WatcherOrchestrator(
      storage,
      makeWiki(),
      undefined,
      undefined as never,
      {
        amp: {
          listRecentThreads: mock(async () => ["first", "second"]),
          parse: mock(async (threadId: string) => sessions.find((session) => session.id === `amp-${threadId}`) ?? null),
          watchPaths: () => [],
        },
      } as never,
    );

    const originalError = console.error;
    console.error = mock(() => {});
    try {
      await orchestrator.pollAmp();
    } finally {
      console.error = originalError;
    }

    expect(processSessionMock).toHaveBeenCalledTimes(2);
    expect((storage as { recordProcessedSession: ReturnType<typeof mock> }).recordProcessedSession).toHaveBeenCalledTimes(1);
  });
});
