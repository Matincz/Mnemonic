// tests/parsers/gemini.test.ts
import { describe, it, expect } from "bun:test";
import { GeminiParser } from "../../src/parsers/gemini";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/gemini-session.json");

describe("GeminiParser", () => {
  const parser = new GeminiParser();

  it("parses JSON into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("gemini");
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("singleton");
    expect(session!.messages[1].role).toBe("assistant");
  });
});
