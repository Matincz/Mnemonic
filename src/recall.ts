import { normalizeProjectName } from "./pipeline/project";
import { effectiveSalience, type Storage } from "./storage";
import type { Memory, MemoryLayer, MemorySearchResult } from "./types";

export interface RecallOptions {
  task: string;
  cwd?: string;
  limit?: number;
}

export interface RecallMemory {
  id: string;
  layer: MemoryLayer;
  title: string;
  summary: string;
  status: Memory["status"];
  salience: number;
  score: number;
  reasons: string[];
  whyIncluded: string[];
  sourceSessionId: string;
  sourceAgent: Memory["sourceAgent"];
}

export interface RecallCapsule {
  task: string;
  project?: string;
  cwd?: string;
  confidence: "high" | "medium" | "low";
  context: string;
  memories: RecallMemory[];
}

const DEFAULT_LIMIT = 5;
const STATUS_PRIORITY: Record<Memory["status"], number> = {
  verified: 4,
  observed: 3,
  proposed: 1,
  superseded: 0,
};

const LAYER_PRIORITY: Record<MemoryLayer, number> = {
  procedural: 4,
  insight: 3,
  semantic: 2,
  episodic: 1,
};

export async function buildRecallCapsule(storage: Storage, options: RecallOptions): Promise<RecallCapsule> {
  const task = options.task.trim();
  const project = inferRecallProject(options.cwd);
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (!task) {
    return emptyCapsule(task, options.cwd, project);
  }

  const results = await storage.search(task, Math.max(limit * 4, 20));
  const memories = results
    .filter((result) => shouldInclude(result.memory, project))
    .sort(compareRecallHits)
    .slice(0, limit)
    .map((result) => formatRecallMemory(result, project));

  return {
    task,
    project,
    cwd: options.cwd,
    confidence: recallConfidence(memories),
    context: renderRecallContext(memories),
    memories,
  };
}

function inferRecallProject(cwd?: string) {
  return normalizeProjectName(cwd);
}

function shouldInclude(memory: Memory, project?: string) {
  if (memory.status === "superseded" || memory.status === "proposed") {
    return false;
  }

  if (!project) {
    return true;
  }

  return !memory.project || normalizeProjectName(memory.project) === project;
}

function compareRecallHits(left: MemorySearchResult, right: MemorySearchResult) {
  return (
    projectSpecificity(right.memory) - projectSpecificity(left.memory) ||
    STATUS_PRIORITY[right.memory.status] - STATUS_PRIORITY[left.memory.status] ||
    LAYER_PRIORITY[right.memory.layer] - LAYER_PRIORITY[left.memory.layer] ||
    effectiveSalience(right.memory) - effectiveSalience(left.memory) ||
    right.score - left.score
  );
}

function projectSpecificity(memory: Memory) {
  return memory.project ? 1 : 0;
}

function formatRecallMemory(result: MemorySearchResult, project?: string): RecallMemory {
  return {
    id: result.memory.id,
    layer: result.memory.layer,
    title: result.memory.title,
    summary: result.memory.summary,
    status: result.memory.status,
    salience: result.memory.salience,
    score: result.score,
    reasons: result.reasons,
    whyIncluded: whyIncluded(result.memory, project),
    sourceSessionId: result.memory.sourceSessionId,
    sourceAgent: result.memory.sourceAgent,
  };
}

function whyIncluded(memory: Memory, project?: string) {
  const reasons = ["query-match"];
  if (project && memory.project && normalizeProjectName(memory.project) === project) {
    reasons.push("project");
  }
  if (memory.status === "verified") {
    reasons.push("verified");
  }
  if (memory.layer === "procedural" || memory.layer === "insight") {
    reasons.push(memory.layer);
  }
  return reasons;
}

function recallConfidence(memories: RecallMemory[]): RecallCapsule["confidence"] {
  if (
    memories.some((memory) => memory.status === "verified") ||
    memories.some((memory) => (memory.layer === "procedural" || memory.layer === "insight") && memory.salience >= 0.75) ||
    memories.length >= 2
  ) {
    return "high";
  }
  if (memories.length === 1) {
    return "medium";
  }
  return "low";
}

function renderRecallContext(memories: RecallMemory[]) {
  if (memories.length === 0) {
    return "Relevant memory:\n- none";
  }

  const lines = ["Relevant memory:"];
  for (const memory of memories) {
    lines.push(`- [${memory.layer}] ${memory.title}: ${memory.summary}`);
  }
  return lines.join("\n");
}

function emptyCapsule(task: string, cwd?: string, project?: string): RecallCapsule {
  return {
    task,
    project,
    cwd,
    confidence: "low",
    context: "Relevant memory:\n- none",
    memories: [],
  };
}
