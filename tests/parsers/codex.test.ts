// tests/parsers/codex.test.ts
import { describe, it, expect } from "bun:test";
import { CodexParser } from "../../src/parsers/codex";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/codex-session.jsonl");

describe("CodexParser", () => {
  const parser = new CodexParser();

  it("parses JSONL into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("codex");
    expect(session!.messages).toHaveLength(4);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("configure the database");
    expect(session!.messages[1].role).toBe("assistant");
    expect(session!.timestamp).toBeInstanceOf(Date);
  });

  it("returns watch paths", () => {
    const paths = parser.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(".codex/sessions");
  });
});
