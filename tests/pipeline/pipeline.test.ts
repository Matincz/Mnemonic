// tests/pipeline/pipeline.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { join } from "path";
import type { Memory, ParsedSession } from "../../src/types";

// We test the pipeline stages individually since full pipeline requires LLM
import { CodexParser } from "../../src/parsers/codex";

const FIXTURE = join(import.meta.dir, "../fixtures/codex-session.jsonl");
const evaluateMock = mock(async () => ({ shouldProcess: true }));
const ingestMock = mock(async (): Promise<Memory[]> => []);
const linkBatchMock = mock(async (memories: Memory[]): Promise<Memory[]> => memories);
const consolidateMock = mock(async (memories: Memory[]): Promise<Memory[]> => memories);
const reflectMock = mock(async (): Promise<Memory[]> => []);
type MockWikiOp = { action: string; type: string; slug: string; title: string; reason: string };
const wikiIngestMock = mock(async (): Promise<MockWikiOp[]> => []);

mock.module("../../src/pipeline/evaluator", () => ({
  evaluate: evaluateMock,
}));

mock.module("../../src/pipeline/ingestor", () => ({
  ingest: ingestMock,
}));

mock.module("../../src/pipeline/linker", () => ({
  linkBatch: linkBatchMock,
}));

mock.module("../../src/pipeline/consolidator", () => ({
  consolidate: consolidateMock,
}));

mock.module("../../src/pipeline/reflector", () => ({
  reflect: reflectMock,
}));

mock.module("../../src/pipeline/wiki-ingestor", () => ({
  wikiIngest: wikiIngestMock,
}));

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary of memory ${id} with enough detail to pass quality filters in normalization`,
    details: `Detailed description of memory ${id} providing sufficient content to exceed minimum thresholds`,
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

function makeSession(): ParsedSession {
  return {
    id: "session-1",
    source: "codex",
    timestamp: new Date("2026-04-16T00:00:00.000Z"),
    rawPath: FIXTURE,
    messages: [
      { role: "user", content: "Remember this fix." },
      { role: "assistant", content: "Implemented the durable pipeline change." },
    ],
  };
}

function makeStorage() {
  const checkpoints = new Map<string, unknown>();

  return {
    db: {
      loadCheckpoint<T>(sessionId: string, stage: string): T | null {
        const key = `${sessionId}:${stage}`;
        return checkpoints.has(key) ? checkpoints.get(key) as T : null;
      },
      saveCheckpoint(sessionId: string, stage: string, payload: unknown) {
        checkpoints.set(`${sessionId}:${stage}`, payload);
      },
    },
  } as never;
}

function makeWiki() {
  return {
    engine: {
      saveRawSession: mock(() => {}),
    },
    index: {},
    log: {},
    registry: {},
  } as never;
}

beforeEach(() => {
  evaluateMock.mockClear();
  ingestMock.mockClear();
  linkBatchMock.mockClear();
  consolidateMock.mockClear();
  reflectMock.mockClear();
  wikiIngestMock.mockClear();

  evaluateMock.mockImplementation(async () => ({ shouldProcess: true }));
  ingestMock.mockImplementation(async (): Promise<Memory[]> => []);
  linkBatchMock.mockImplementation(async (memories: Memory[]): Promise<Memory[]> => memories);
  consolidateMock.mockImplementation(async (memories: Memory[]): Promise<Memory[]> => memories);
  reflectMock.mockImplementation(async (): Promise<Memory[]> => []);
  wikiIngestMock.mockImplementation(async (): Promise<MockWikiOp[]> => []);
});

describe("Pipeline integration", () => {
  it("parses fixture and produces valid session", async () => {
    const parser = new CodexParser();
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.messages.length).toBeGreaterThanOrEqual(2);
    expect(session!.source).toBe("codex");
    // Session is ready for pipeline processing
    expect(session!.id).toBeTruthy();
    expect(session!.timestamp).toBeInstanceOf(Date);
  });

  it("keeps consolidated memories when reflect fails", async () => {
    const consolidated = [makeMemory("core-1", { layer: "procedural" })];

    ingestMock.mockImplementation(async (): Promise<Memory[]> => [makeMemory("raw-1")]);
    consolidateMock.mockImplementation(async (): Promise<Memory[]> => consolidated);
    reflectMock.mockImplementation(async (): Promise<Memory[]> => {
      throw new Error("llm down");
    });
    wikiIngestMock.mockImplementation(async () => [
      { action: "update", type: "pattern", slug: "fail-open", title: "Fail Open", reason: "learned" },
    ]);

    const { processSession } = await import("../../src/pipeline");
    const result = await processSession(makeSession(), makeStorage(), makeWiki(), () => {});

    expect(result.stage).toBe("done");
    expect(result.skipped).toBe(false);
    expect(result.memories).toEqual(consolidated);
    expect(result.warnings).toEqual(["reflect failed: llm down"]);
    expect(result.wikiOps).toEqual([
      { action: "update", type: "pattern", slug: "fail-open", title: "Fail Open", reason: "learned" },
    ]);
  });

  it("keeps core memories when wiki ingest fails", async () => {
    const consolidated = [makeMemory("core-1", { layer: "procedural" })];
    const insights = [makeMemory("insight-1", { layer: "insight" })];

    ingestMock.mockImplementation(async (): Promise<Memory[]> => [makeMemory("raw-1")]);
    consolidateMock.mockImplementation(async (): Promise<Memory[]> => consolidated);
    reflectMock.mockImplementation(async (): Promise<Memory[]> => insights);
    wikiIngestMock.mockImplementation(async () => {
      throw new Error("wiki timeout");
    });

    const { processSession } = await import("../../src/pipeline");
    const result = await processSession(makeSession(), makeStorage(), makeWiki(), () => {});

    expect(result.stage).toBe("done");
    expect(result.skipped).toBe(false);
    expect(result.memories).toEqual([...consolidated, ...insights]);
    expect(result.wikiOps).toEqual([]);
    expect(result.warnings).toEqual(["wiki-ingest failed: wiki timeout"]);
  });

  it("falls back to normalized memories when linking fails", async () => {
    const normalized = [makeMemory("core-1", { layer: "procedural" })];

    ingestMock.mockImplementation(async (): Promise<Memory[]> => normalized);
    linkBatchMock.mockImplementation(async () => {
      throw new Error("bad link schema");
    });

    const { processSession } = await import("../../src/pipeline");
    const result = await processSession(makeSession(), makeStorage(), makeWiki(), () => {});

    expect(result.stage).toBe("done");
    expect(result.memories).toEqual(normalized);
    expect(result.warnings).toEqual(["linking failed: bad link schema"]);
  });

  it("falls back to linked memories when consolidation fails", async () => {
    const linked = [makeMemory("core-1", { layer: "procedural" })];

    ingestMock.mockImplementation(async (): Promise<Memory[]> => [makeMemory("raw-1")]);
    linkBatchMock.mockImplementation(async (): Promise<Memory[]> => linked);
    consolidateMock.mockImplementation(async () => {
      throw new Error("bad consolidation schema");
    });

    const { processSession } = await import("../../src/pipeline");
    const result = await processSession(makeSession(), makeStorage(), makeWiki(), () => {});

    expect(result.stage).toBe("done");
    expect(result.memories).toEqual(linked);
    expect(result.warnings).toEqual(["consolidating failed: bad consolidation schema"]);
  });

  it("normalizes extracted memories before linking", async () => {
    const duplicateRich = makeMemory("rich", {
      title: "Auth token rotation procedure",
      summary: "Rotate auth tokens safely",
      details: "Detailed guide to rotating auth tokens in production environments with rollback notes",
      tags: ["auth", "security"],
    });

    ingestMock.mockImplementation(async (): Promise<Memory[]> => [
      makeMemory("thin", {
        title: "Thin memory",
        summary: "Thin memory",
        details: "",
      }),
      makeMemory("dup-1", {
        title: "Auth token rotation",
        summary: "Rotate auth tokens securely in production systems following standard practices",
        details: "Auth token rotation short duplicate with insufficient detail",
        tags: ["auth"],
      }),
      duplicateRich,
      makeMemory("weak", {
        layer: "semantic",
        salience: 0.2,
        title: "Transient environment observation",
        summary: "Observed timezone setting during session startup for the current workspace",
        details: "Short detail that is meaningful but low salience for durable storage",
      }),
    ]);

    const { processSession } = await import("../../src/pipeline");
    await processSession(makeSession(), makeStorage(), makeWiki(), () => {});

    expect(linkBatchMock).toHaveBeenCalledTimes(1);
    const normalized = linkBatchMock.mock.calls[0]?.[0] as Memory[];
    expect(normalized).toHaveLength(2);
    expect(normalized.find((memory) => memory.id === "rich")?.tags).toEqual(["auth", "security"]);
    expect(normalized.find((memory) => memory.id === "weak")?.layer).toBe("episodic");
  });
});
