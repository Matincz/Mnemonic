import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ParsedSession } from "../../src/types";

const llmGenerateJSONMock = mock(async () => ({
  worth_remembering: true,
  reason: "durable",
  estimated_layers: ["semantic"],
}));

beforeEach(() => {
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
});
