// src/parsers/claude-code.ts
import { basename } from "path";
import { loadConfig } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";
import { readJsonLines } from "./jsonl";

interface ClaudeEntry {
  type: string;
  message?: {
    role: string;
    content: unknown;
  };
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
}

export class ClaudeCodeParser implements SessionParser {
  name = "claude-code";

  constructor(private root = loadConfig().sources.claudeCode) {}

  async parse(filePath: string): Promise<ParsedSession | null> {
    const entries = await readJsonLines<ClaudeEntry>(filePath);
    const messages: SessionMessage[] = [];
    let firstTimestamp: Date | null = null;
    let project: string | undefined;

    for (const entry of entries) {
      // Only process user/assistant message entries
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      if (!entry.message?.content) continue;

      const textParts = extractTextParts(entry.message.content);
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
    return [this.root];
  }
}

function extractTextParts(content: unknown): string[] {
  if (typeof content === "string") {
    return content.trim() ? [content] : [];
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((item) => {
        if (typeof item === "string") {
          return item.trim() ? [item] : [];
        }

        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          if (record.type === "text" && typeof record.text === "string" && record.text.trim()) {
            return [record.text];
          }
          if (typeof record.text === "string" && record.text.trim()) {
            return [record.text];
          }
        }

        return [];
      });
  }

  if (typeof content === "object" && content !== null) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim()) {
      return [record.text];
    }
  }

  return [];
}
