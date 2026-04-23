// src/parsers/openclaw.ts
import { basename } from "path";
import { loadConfig } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";
import { readJsonLines } from "./jsonl";

interface OpenClawEntry {
  type: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
}

export class OpenClawParser implements SessionParser {
  name = "openclaw";

  constructor(private root = loadConfig().sources.openclaw) {}

  async parse(filePath: string): Promise<ParsedSession | null> {
    const entries = await readJsonLines<OpenClawEntry>(filePath);
    const messages: SessionMessage[] = [];
    let sessionId = "";
    let firstTimestamp: Date | null = null;
    let project: string | undefined;

    for (const entry of entries) {
      if (entry.type === "session") {
        sessionId = entry.id ?? basename(filePath, ".jsonl");
        if (entry.cwd) project = basename(entry.cwd);
        if (entry.timestamp) firstTimestamp = new Date(entry.timestamp);
        continue;
      }

      if (entry.type !== "message") continue;
      if (!entry.message?.content) continue;

      const textParts =
        typeof entry.message.content === "string"
          ? (entry.message.content.trim() ? [entry.message.content] : [])
          : entry.message.content
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
    return [this.root];
  }
}
