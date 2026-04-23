import { basename } from "path";
import { loadConfig } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";
import { readJsonLines } from "./jsonl";

interface CodexEntry {
  timestamp: string;
  type: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{ type: string; text?: string }>;
  };
}

export class CodexParser implements SessionParser {
  name = "codex";

  constructor(private root = loadConfig().sources.codex) {}

  async parse(filePath: string): Promise<ParsedSession | null> {
    const entries = await readJsonLines<CodexEntry>(filePath);
    const messages: SessionMessage[] = [];
    let firstTimestamp: Date | null = null;

    for (const entry of entries) {
      if (entry.type !== "response_item") continue;
      const payload = entry.payload;
      if (!payload?.role || !payload.content) continue;

      const role = payload.role === "developer" ? "system" : payload.role as SessionMessage["role"];
      const textParts = payload.content
        .filter((c) => c.text)
        .map((c) => c.text!);
      if (textParts.length === 0) continue;

      const ts = new Date(entry.timestamp);
      if (!firstTimestamp) firstTimestamp = ts;

      messages.push({
        role,
        content: textParts.join("\n"),
        timestamp: ts,
      });
    }

    if (messages.length === 0) return null;

    // Extract session ID from filename like "rollout-2026-04-13T11-34-36-<uuid>.jsonl"
    const name = basename(filePath, ".jsonl");
    const uuidMatch = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const id = uuidMatch ? `codex-${uuidMatch[1]}` : `codex-${name}`;

    return {
      id,
      source: "codex",
      timestamp: firstTimestamp!,
      messages,
      rawPath: filePath,
    };
  }

  watchPaths(): string[] {
    return [this.root];
  }
}
