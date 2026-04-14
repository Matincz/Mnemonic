// tests/parsers/openclaw.test.ts
import { describe, it, expect } from "bun:test";
import { OpenClawParser } from "../../src/parsers/openclaw";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/openclaw-session.jsonl");

describe("OpenClawParser", () => {
  const parser = new OpenClawParser();

  it("parses JSONL into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("openclaw");
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0].content).toContain("MQTT");
    expect(session!.id).toBe("openclaw-test-openclaw-session");
  });

  it("extracts project from session cwd", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session!.project).toBe("iot-project");
  });
});
