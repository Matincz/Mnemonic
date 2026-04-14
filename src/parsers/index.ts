// src/parsers/index.ts
import type { SessionParser } from "./base";
import { CodexParser } from "./codex";
import { ClaudeCodeParser } from "./claude-code";
import { GeminiParser } from "./gemini";
import { OpenCodeParser } from "./opencode";
import { OpenClawParser } from "./openclaw";
import { AmpParser } from "./amp";

export const parsers: Record<string, SessionParser> = {
  codex: new CodexParser(),
  "claude-code": new ClaudeCodeParser(),
  gemini: new GeminiParser(),
  opencode: new OpenCodeParser(),
  openclaw: new OpenClawParser(),
  amp: new AmpParser(),
};

export { CodexParser, ClaudeCodeParser, GeminiParser, OpenCodeParser, OpenClawParser, AmpParser };
export type { SessionParser } from "./base";
