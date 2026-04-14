// src/parsers/gemini.ts
import { readFile } from "fs/promises";
import { basename, dirname } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface GeminiSession {
  sessionId: string;
  startTime?: string;
  lastUpdated?: string;
  messages: Array<{
    id: string;
    timestamp: string;
    type: "user" | "gemini";
    content: string | Array<{ text: string }>;
    thoughts?: Array<{ subject: string; description: string }>;
  }>;
}

export class GeminiParser implements SessionParser {
  name = "gemini";

  async parse(filePath: string): Promise<ParsedSession | null> {
    const raw = await readFile(filePath, "utf-8");
    let data: GeminiSession;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!data.messages?.length) return null;

    // Extract project name from parent directories
    // Path: ~/.gemini/tmp/<project>/chats/session-*.json
    const projectDir = basename(dirname(dirname(filePath)));

    const messages: SessionMessage[] = data.messages.map((msg) => {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content.map((c) => c.text).join("\n");

      return {
        role: msg.type === "gemini" ? "assistant" as const : "user" as const,
        content,
        timestamp: new Date(msg.timestamp),
      };
    });

    return {
      id: `gemini-${data.sessionId}`,
      source: "gemini",
      timestamp: new Date(data.startTime ?? data.messages[0].timestamp),
      project: projectDir !== "tmp" ? projectDir : undefined,
      messages,
      rawPath: filePath,
    };
  }

  watchPaths(): string[] {
    return [config.sources.gemini];
  }
}
