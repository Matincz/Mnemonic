import type { ParsedSession, Memory } from "../types";

/** Truncate session to fit context window */
function truncateMessages(session: ParsedSession, maxChars = 12000): string {
  const lines: string[] = [];
  let total = 0;
  for (const msg of session.messages) {
    const line = `[${msg.role}]: ${msg.content}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n\n");
}

export function evaluatePrompt(session: ParsedSession): string {
  const transcript = truncateMessages(session, 4000);
  return `You are a memory curator. Analyze this AI agent session and decide if it contains information worth remembering long-term.

Session from: ${session.source} (${session.timestamp.toISOString()})
Project: ${session.project ?? "unknown"}

TRANSCRIPT:
${transcript}

Respond with JSON:
{
  "worth_remembering": true/false,
  "reason": "brief explanation",
  "estimated_layers": ["episodic", "semantic", "procedural", "insight"] // which memory layers this could contribute to
}`;
}

export function ingestPrompt(session: ParsedSession): string {
  const transcript = truncateMessages(session);
  return `You are a memory extractor. Extract structured memories from this AI agent session.

Session from: ${session.source} (${session.timestamp.toISOString()})
Project: ${session.project ?? "unknown"}

TRANSCRIPT:
${transcript}

For each distinct piece of knowledge, create a memory object. Respond with a JSON array:
[
  {
    "layer": "episodic" | "semantic" | "procedural" | "insight",
    "title": "short descriptive title (max 60 chars)",
    "summary": "1-2 sentence summary (L1 disclosure)",
    "details": "full details with code snippets if relevant (L2 disclosure)",
    "tags": ["tag1", "tag2"],
    "salience": 0.0-1.0 (how important/reusable is this?)
  }
]

Guidelines:
- episodic: specific events ("Fixed X on date Y")
- semantic: factual knowledge ("Project uses X library")
- procedural: how-to steps ("To deploy: do X then Y")
- insight: patterns/learnings ("When X happens, Y is usually the cause")
- salience: 0.9+ = critical, 0.7-0.9 = important, 0.5-0.7 = moderate, <0.5 = minor`;
}

export function linkPrompt(newMemory: Memory, existingMemories: Memory[]): string {
  const existing = existingMemories
    .map((m) => `[${m.id}] ${m.title}: ${m.summary}`)
    .join("\n");

  return `You are a memory linker. Given a new memory and existing memories, find connections and contradictions.

NEW MEMORY:
Title: ${newMemory.title}
Summary: ${newMemory.summary}
Details: ${newMemory.details}
Tags: ${newMemory.tags.join(", ")}

EXISTING MEMORIES:
${existing || "(none)"}

Respond with JSON:
{
  "linked_ids": ["id1", "id2"],
  "contradicts_ids": ["id3"],
  "explanation": "brief reasoning"
}`;
}
