// src/parsers/openclaw.ts
import { readFile } from "fs/promises";
import { basename } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface OpenClawEntry {
  type: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
}

export class OpenClawParser implements SessionParser {
  name = "openclaw";

  async parse(filePath: string): Promise<ParsedSession | null> {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messages: SessionMessage[] = [];
    let sessionId = "";
    let firstTimestamp: Date | null = null;
    let project: string | undefined;

    for (const line of lines) {
      let entry: OpenClawEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "session") {
        sessionId = entry.id ?? basename(filePath, ".jsonl");
        if (entry.cwd) project = basename(entry.cwd);
        if (entry.timestamp) firstTimestamp = new Date(entry.timestamp);
        continue;
      }

      if (entry.type !== "message") continue;
      if (!entry.message?.content) continue;

      const textParts = entry.message.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      if (textParts.length === 0) continue;

      const ts = entry.timestamp ? new Date(entry.timestamp) : undefined;
      if (ts && !firstTimestamp) firstTimestamp = ts;

      messages.push({
        role: entry.message.role as SessionMessage["role"],
        content: textParts.join("\n"),
        timestamp: ts,
      });
    }

    if (messages.length === 0) return null;

    return {
      id: `openclaw-${sessionId}`,
      source: "openclaw",
      timestamp: firstTimestamp ?? new Date(),
      project,
      messages,
      rawPath: filePath,
    };
  }

  watchPaths(): string[] {
    return [config.sources.openclaw];
  }
}
