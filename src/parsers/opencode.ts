// src/parsers/opencode.ts
import { Database } from "bun:sqlite";
import { basename } from "path";
import { loadConfig } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface RawOpenCodeSession {
  sessionId: string;
  title: string;
  directory: string;
  timeCreated: number;
  messages: Array<{ role: string; content: string; timeCreated: number }>;
}

export interface OpenCodeReadOptions {
  maxAgeDays?: number | null;
}

export class OpenCodeParser implements SessionParser {
  name = "opencode";

  constructor(
    private dbSourcePath = loadConfig().sources.opencode,
    private maxAgeDays = loadConfig().maxSessionAgeDays,
  ) {}

  /** Parse directly from the SQLite database */
  async parse(dbPath: string): Promise<ParsedSession | null> {
    // For OpenCode we return the most recent session
    const sessions = this.readFromDb(dbPath, { maxAgeDays: this.maxAgeDays });
    return sessions[0] ?? null;
  }

  /** Read all recent sessions from the database */
  readFromDb(dbPath: string, options: OpenCodeReadOptions = {}): ParsedSession[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      const hasAgeLimit = options.maxAgeDays !== null && options.maxAgeDays !== undefined;
      const maxAgeDays = hasAgeLimit ? options.maxAgeDays! : null;
      const cutoff = maxAgeDays !== null ? Date.now() - maxAgeDays * 86400_000 : null;
      const whereClause = hasAgeLimit ? "WHERE s.time_updated > ?" : "";

      const rows = db.prepare(`
        SELECT s.id, s.title, s.directory, s.time_created,
               m.data, m.time_created as msg_time
        FROM session s
        JOIN message m ON m.session_id = s.id
        ${whereClause}
        ORDER BY s.time_created DESC, m.time_created ASC
      `).all(...(hasAgeLimit ? [cutoff] : [])) as Array<{
        id: string; title: string; directory: string;
        time_created: number; data: string; msg_time: number;
      }>;

      // Group by session
      const grouped = new Map<string, { session: any; messages: any[] }>();
      for (const row of rows) {
        if (!grouped.has(row.id)) {
          grouped.set(row.id, {
            session: row,
            messages: [],
          });
        }
        try {
          const msgData = JSON.parse(row.data);
          if (msgData.role === "user" || msgData.role === "assistant") {
            grouped.get(row.id)!.messages.push({
              role: msgData.role,
              content: typeof msgData.content === "string"
                ? msgData.content
                : JSON.stringify(msgData.content),
              timeCreated: row.msg_time,
            });
          }
        } catch {}
      }

      return this.convertRawSessions(
        [...grouped.values()].map((g) => ({
          sessionId: g.session.id,
          title: g.session.title,
          directory: g.session.directory,
          timeCreated: g.session.time_created,
          messages: g.messages,
        }))
      );
    } finally {
      db.close();
    }
  }

  /** Convert raw session data to ParsedSession array (also used in tests) */
  convertRawSessions(raw: RawOpenCodeSession[]): ParsedSession[] {
    return raw.map((s) => ({
      id: `opencode-${s.sessionId}`,
      source: "opencode" as const,
      timestamp: new Date(s.timeCreated),
      project: basename(s.directory),
      messages: s.messages.map((m) => ({
        role: m.role as SessionMessage["role"],
        content: m.content,
        timestamp: new Date(m.timeCreated),
      })),
      rawPath: this.dbSourcePath,
    }));
  }

  watchPaths(): string[] {
    return [this.dbSourcePath];
  }
}
