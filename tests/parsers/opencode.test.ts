// tests/parsers/opencode.test.ts
import { describe, it, expect } from "bun:test";
import { OpenCodeParser } from "../../src/parsers/opencode";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

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

  it("can read all historical sessions when maxAgeDays is null", () => {
    const tempRoot = join(tmpdir(), `mnemonic-opencode-${Date.now()}`);
    const dbPath = join(tempRoot, "opencode.db");
    mkdirSync(tempRoot, { recursive: true });

    const now = Date.now();
    const oldTime = now - 30 * 86400_000;
    const recentTime = now - 3600_000;

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        title TEXT,
        directory TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE message (
        session_id TEXT,
        data TEXT,
        time_created INTEGER
      );
    `);

    db.prepare(
      "INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
    ).run("old-session", "Old", "/tmp/old-project", oldTime, oldTime);
    db.prepare(
      "INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
    ).run("recent-session", "Recent", "/tmp/recent-project", recentTime, recentTime);

    db.prepare("INSERT INTO message (session_id, data, time_created) VALUES (?, ?, ?)")
      .run("old-session", JSON.stringify({ role: "user", content: "old content" }), oldTime);
    db.prepare("INSERT INTO message (session_id, data, time_created) VALUES (?, ?, ?)")
      .run("recent-session", JSON.stringify({ role: "assistant", content: "recent content" }), recentTime);
    db.close();

    const recentOnly = parser.readFromDb(dbPath, { maxAgeDays: 7 });
    const allSessions = parser.readFromDb(dbPath, { maxAgeDays: null });

    expect(recentOnly.map((session) => session.id)).toEqual(["opencode-recent-session"]);
    expect(allSessions.map((session) => session.id).sort()).toEqual([
      "opencode-old-session",
      "opencode-recent-session",
    ]);

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
