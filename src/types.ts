import { z } from "zod";

export type AgentSource = "codex" | "claude-code" | "gemini" | "opencode" | "openclaw" | "amp";
export type MemoryLayer = "episodic" | "semantic" | "procedural" | "insight";
export type DisclosureLevel = "L0" | "L1" | "L2" | "L3";

export interface ParsedSession {
  id: string;
  source: AgentSource;
  timestamp: Date;
  project?: string;
  messages: SessionMessage[];
  rawPath: string;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: Date;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
  reasons: string[];
}

export const MemorySchema = z.object({
  id: z.string(),
  layer: z.enum(["episodic", "semantic", "procedural", "insight"]),
  title: z.string(),
  summary: z.string(),
  details: z.string(),
  tags: z.array(z.string()),
  project: z.string().optional(),
  sourceSessionId: z.string(),
  sourceAgent: z.enum(["codex", "claude-code", "gemini", "opencode", "openclaw", "amp"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum(["proposed", "observed", "verified", "superseded"]),
  sourceSessionIds: z.array(z.string()),
  supportingMemoryIds: z.array(z.string()),
  salience: z.number().min(0).max(1),
  linkedMemoryIds: z.array(z.string()),
  contradicts: z.array(z.string()),
});

export type Memory = z.infer<typeof MemorySchema>;

export type PipelineStage =
  | "evaluating"
  | "ingesting"
  | "linking"
  | "consolidating"
  | "reflecting"
  | "done"
  | "skipped";

export interface PipelineResult {
  sessionId: string;
  stage: PipelineStage;
  memories: Memory[];
  skipped: boolean;
  reason?: string;
  wikiOps?: Array<{ action: string; type: string; slug: string; title: string; reason: string }>;
  warnings?: string[];
}

export interface ProcessedFile {
  path: string;
  hash: string;
  processedAt: string;
  sessionId: string;
}
