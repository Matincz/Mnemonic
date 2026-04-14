// tests/parsers/claude-code.test.ts
import { describe, it, expect } from "bun:test";
import { ClaudeCodeParser } from "../../src/parsers/claude-code";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/claude-session.jsonl");

describe("ClaudeCodeParser", () => {
  const parser = new ClaudeCodeParser();

  it("parses JSONL into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("claude-code");
    expect(session!.messages).toHaveLength(4);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("CORS");
  });

  it("extracts project from cwd", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session!.project).toBe("my-project");
  });
});
