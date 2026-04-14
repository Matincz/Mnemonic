// src/parsers/claude-code.ts
import { readFile } from "fs/promises";
import { basename, dirname } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface ClaudeEntry {
  type: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
}

export class ClaudeCodeParser implements SessionParser {
  name = "claude-code";

  async parse(filePath: string): Promise<ParsedSession | null> {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messages: SessionMessage[] = [];
    let firstTimestamp: Date | null = null;
    let project: string | undefined;

    for (const line of lines) {
      let entry: ClaudeEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      // Only process user/assistant message entries
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      if (!entry.message?.content) continue;

      const textParts = entry.message.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      if (textParts.length === 0) continue;

      const role = entry.message.role as SessionMessage["role"];
      const ts = entry.timestamp ? new Date(entry.timestamp) : undefined;
      if (ts && !firstTimestamp) firstTimestamp = ts;

      // Extract project name from cwd
      if (!project && entry.cwd) {
        project = basename(entry.cwd);
      }

      messages.push({ role, content: textParts.join("\n"), timestamp: ts });
    }

    if (messages.length === 0) return null;

    const sessionName = basename(filePath, ".jsonl");
    return {
      id: `claude-${sessionName}`,
      source: "claude-code",
      timestamp: firstTimestamp ?? new Date(),
      project,
      messages,
      rawPath: filePath,
    };
  }

  watchPaths(): string[] {
    return [config.sources.claudeCode];
  }
}
