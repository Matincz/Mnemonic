import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ParsedSession } from "../../src/types";

const llmGenerateJSONMock = mock(async () => ({
  worth_remembering: true,
  reason: "durable",
  estimated_layers: ["semantic"],
}));

beforeEach(() => {
  mock.restore();
  llmGenerateJSONMock.mockClear();
  mock.module("../../src/llm", () => ({
    llmGenerateJSON: llmGenerateJSONMock,
  }));
});

function makeSession(content: string): ParsedSession {
  return {
    id: "session-1",
    source: "codex",
    timestamp: new Date("2026-04-21T00:00:00.000Z"),
    rawPath: "/tmp/session.jsonl",
    messages: [
      { role: "user", content },
      { role: "assistant", content: "Acknowledged." },
    ],
  };
}

function makeSessionFromMessages(messages: ParsedSession["messages"]): ParsedSession {
  return {
    id: "session-1",
    source: "codex",
    timestamp: new Date("2026-04-21T00:00:00.000Z"),
    rawPath: "/tmp/session.jsonl",
    messages,
  };
}

describe("evaluate heuristics", () => {
  it("skips repeated automation success logs before calling the llm", async () => {
    const { evaluate } = await import("../../src/pipeline/evaluator");
    const result = await evaluate(
      makeSession("cron sync heartbeat completed successfully and pushed data to upstream storage"),
    );

    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toContain("repeated automation");
    expect(llmGenerateJSONMock).not.toHaveBeenCalled();
  });

  it("skips environment snapshot sessions before calling the llm", async () => {
    const { evaluate } = await import("../../src/pipeline/evaluator");
    const result = await evaluate(
      makeSession("cwd: /tmp/project shell: zsh timezone: Asia/Shanghai PATH=/usr/bin:/bin HOME=/Users/test"),
    );

    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toContain("environment snapshot");
    expect(llmGenerateJSONMock).not.toHaveBeenCalled();
  });

  it("skips benign telemetry sessions before calling the llm", async () => {
    const { evaluate } = await import("../../src/pipeline/evaluator");
    const result = await evaluate(
      makeSession("sensor reading shows tire pressure telemetry and battery voltage reading within normal range"),
    );

    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toContain("telemetry");
    expect(llmGenerateJSONMock).not.toHaveBeenCalled();
  });

  it("skips unresolved failure loops before calling the llm", async () => {
    const { evaluate } = await import("../../src/pipeline/evaluator");
    const repeatedError = "ERROR: database connection timeout while replaying sync batch #42";
    const result = await evaluate(
      makeSessionFromMessages([
        { role: "user", content: "Please fix this ingestion issue." },
        { role: "assistant", content: repeatedError },
        { role: "assistant", content: repeatedError },
        { role: "assistant", content: repeatedError },
        { role: "assistant", content: repeatedError },
        { role: "assistant", content: "Still investigating." },
      ]),
    );

    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toContain("unresolved failure loop");
    expect(llmGenerateJSONMock).not.toHaveBeenCalled();
  });

  it("skips pure browsing sessions before calling the llm", async () => {
    const { evaluate } = await import("../../src/pipeline/evaluator");
    const result = await evaluate(
      makeSessionFromMessages([
        { role: "user", content: "Show me what's in this repo." },
        { role: "assistant", content: "This repository has a src directory and several tests." },
        { role: "assistant", content: "It appears to be a TypeScript daemon with memory indexing and retrieval features." },
      ]),
    );

    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toContain("pure browsing");
    expect(llmGenerateJSONMock).not.toHaveBeenCalled();
  });

  it("skips user-aborted sessions before calling the llm", async () => {
    const { evaluate } = await import("../../src/pipeline/evaluator");
    const result = await evaluate(
      makeSessionFromMessages([
        { role: "user", content: "Can you continue fixing the daemon?" },
        { role: "assistant", content: "Sure, I can proceed with the patch." },
        { role: "user", content: "Nevermind, stop for now." },
      ]),
    );

    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toContain("aborted");
    expect(llmGenerateJSONMock).not.toHaveBeenCalled();
  });
});
