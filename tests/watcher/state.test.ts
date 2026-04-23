import { describe, expect, it } from "bun:test";
import { sessionHash } from "../../src/watcher/state";
import type { ParsedSession } from "../../src/types";

function buildSession(content: string): ParsedSession {
  return {
    id: "amp-T-test",
    source: "amp",
    timestamp: new Date("2026-04-15T00:00:00.000Z"),
    rawPath: "amp:T-test",
    messages: [
      { role: "user", content: "hello", timestamp: new Date("2026-04-15T00:00:00.000Z") },
      { role: "assistant", content, timestamp: new Date("2026-04-15T00:01:00.000Z") },
    ],
  };
}

describe("sessionHash", () => {
  it("is stable for the same session content", () => {
    const session = buildSession("world");
    expect(sessionHash(session)).toBe(sessionHash(buildSession("world")));
  });

  it("changes when the session content changes", () => {
    expect(sessionHash(buildSession("world"))).not.toBe(sessionHash(buildSession("changed")));
  });
});
