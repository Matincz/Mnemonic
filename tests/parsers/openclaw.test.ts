// tests/parsers/openclaw.test.ts
import { describe, it, expect } from "bun:test";
import { OpenClawParser } from "../../src/parsers/openclaw";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

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

  it("supports string message content in real sessions", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-openclaw-"));
    const tempFile = join(tempDir, "session.jsonl");

    writeFileSync(
      tempFile,
      [
        `{"type":"session","version":3,"id":"test-string-content","timestamp":"2026-04-01T10:00:00.000Z","cwd":"/Users/test/demo"}`,
        `{"type":"message","id":"msg-1","parentId":null,"timestamp":"2026-04-01T10:00:01.000Z","message":{"role":"user","content":"Help me debug this build failure."}}`,
        `{"type":"message","id":"msg-2","parentId":"msg-1","timestamp":"2026-04-01T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Check the compiler diagnostics first."}]}}`,
      ].join("\n"),
    );

    try {
      const session = await parser.parse(tempFile);
      expect(session).not.toBeNull();
      expect(session!.id).toBe("openclaw-test-string-content");
      expect(session!.messages).toHaveLength(2);
      expect(session!.messages[0].content).toContain("build failure");
      expect(session!.messages[1].content).toContain("compiler diagnostics");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
