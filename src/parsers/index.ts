// src/parsers/index.ts
import type { Config } from "../config";
import { loadConfig } from "../config";
import type { SessionParser } from "./base";
import { CodexParser } from "./codex";
import { ClaudeCodeParser } from "./claude-code";
import { GeminiParser } from "./gemini";
import { OpenCodeParser } from "./opencode";
import { OpenClawParser } from "./openclaw";
import { AmpParser } from "./amp";

export function createParsers(cfg: Config = loadConfig()): Record<string, SessionParser> {
  return {
    codex: new CodexParser(cfg.sources.codex),
    "claude-code": new ClaudeCodeParser(cfg.sources.claudeCode),
    gemini: new GeminiParser(cfg.sources.gemini),
    opencode: new OpenCodeParser(cfg.sources.opencode, cfg.maxSessionAgeDays),
    openclaw: new OpenClawParser(cfg.sources.openclaw),
    amp: new AmpParser(),
  };
}

export const parsers: Record<string, SessionParser> = createParsers();

export { CodexParser, ClaudeCodeParser, GeminiParser, OpenCodeParser, OpenClawParser, AmpParser };
export type { SessionParser } from "./base";
