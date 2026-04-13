// tests/pipeline/pipeline.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

// We test the pipeline stages individually since full pipeline requires LLM
import { CodexParser } from "../../src/parsers/codex";

const FIXTURE = join(import.meta.dir, "../fixtures/codex-session.jsonl");

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
});
