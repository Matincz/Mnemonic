// src/parsers/base.ts
import type { ParsedSession } from "../types";

export interface SessionParser {
  /** Human-readable name */
  name: string;
  /** Parse a file or path into a session */
  parse(filePath: string): Promise<ParsedSession | null>;
  /** Glob patterns to watch */
  watchPaths(): string[];
}
