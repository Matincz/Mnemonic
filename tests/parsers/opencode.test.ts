// tests/parsers/opencode.test.ts
import { describe, it, expect } from "bun:test";
import { OpenCodeParser } from "../../src/parsers/opencode";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/opencode-messages.json");

describe("OpenCodeParser", () => {
  const parser = new OpenCodeParser();

  it("parses sessions from fixture data", async () => {
    // Test the internal extraction logic with fixture data
    const raw = await Bun.file(FIXTURE).json();
    const sessions = parser.convertRawSessions(raw);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].source).toBe("opencode");
    expect(sessions[0].messages).toHaveLength(2);
    expect(sessions[0].messages[0].content).toContain("database migration");
    expect(sessions[0].project).toBe("my-app");
  });
});
