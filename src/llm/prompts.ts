import type { ParsedSession, Memory } from "../types";
import type { WikiQuerySource } from "../wiki/query";

/** Strip long code blocks from assistant text, keeping short snippets and error traces */
function stripLongCodeBlocks(text: string): string {
  return text.replace(/```[\w-]*\n([\s\S]*?)```/g, (match, body: string) => {
    const lines = body.split("\n");
    if (lines.length <= 5) return match;

    const lower = body.toLowerCase();
    const isErrorBlock =
      lower.includes("error") ||
      lower.includes("exception") ||
      lower.includes("stack trace") ||
      lower.includes("traceback") ||
      lower.includes("failed") ||
      lower.includes("fatal");
    if (isErrorBlock) return match;

    return "`(code block omitted: " + lines.length + " lines)`";
  });
}

/** Truncate session to fit context window */
export function truncateMessages(session: ParsedSession, maxChars = 70000): string {
  const all = session.messages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => {
      const content = msg.role === "assistant" ? stripLongCodeBlocks(msg.content) : msg.content;
      return `[${msg.role}]: ${content}`;
    });
  if (all.length === 0) {
    return "";
  }

  const total = joinedLength(all);
  if (total <= maxChars) {
    return all.join("\n\n");
  }

  const headCount = Math.min(2, all.length);
  const head = all.slice(0, headCount);
  const separator = "... (truncated) ...";
  const reserved = joinedLength(head) + separator.length + 4;
  const budget = Math.max(0, maxChars - reserved);

  const tail: string[] = [];
  let tailLen = 0;
  for (let index = all.length - 1; index >= headCount; index -= 1) {
    const line = all[index]!;
    const extraJoiner = tail.length > 0 ? 2 : 0;
    if (tailLen + extraJoiner + line.length > budget) {
      break;
    }

    tail.unshift(line);
    tailLen += extraJoiner + line.length;
  }

  if (tail.length === 0 && all.length > headCount && budget > 0) {
    tail.push(all[all.length - 1]!.slice(-budget));
  }

  const parts = tail.length > 0 ? [...head, separator, ...tail] : [...head, separator];
  return parts.join("\n\n");
}

function joinedLength(lines: string[]) {
  if (lines.length === 0) {
    return 0;
  }

  return lines.reduce((sum, line) => sum + line.length, 0) + (lines.length - 1) * 2;
}

export function evaluatePrompt(session: ParsedSession): string {
  const transcript = truncateMessages(session, 20000);
  return `You are a memory curator for an engineering memory system. Analyze this AI agent session and decide if it contains information worth remembering long-term.

Session from: ${session.source} (${session.timestamp.toISOString()})
Project: ${session.project ?? "unknown"}

TRANSCRIPT:
${transcript}

Respond with JSON:
{
  "worth_remembering": true/false,
  "reason": "brief explanation",
  "estimated_layers": ["episodic", "semantic", "procedural", "insight"] // which memory layers this could contribute to
}

Rules:
- Prefer false for trivial chatter, repeated setup noise, or short dead-end debugging.
- Prefer true for durable facts, procedures, decisions, bugs, fixes, patterns, contradictions, or reusable snippets.
- Prefer true when one session contains multiple small durable facts, even if no single fact is large on its own.
- Prefer true for sessions that clarify architecture, config, defaults, edge cases, test fixes, migration notes, or operational guardrails.
- Prefer false for repeated cron/sync execution logs after the first durable lesson has already been captured.
- Prefer false for pure environment context (timezone, shell, cwd, env vars) unless it explains a real bug, decision, or reusable workflow.
- Prefer false for one-off sensor readings or transient measurements unless they show an anomaly, regression, or repeated pattern.
- JSON only.`;
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
- salience distribution target: ~10% at 0.9+, ~25% at 0.7-0.8, ~40% at 0.5-0.6, ~25% at 0.3-0.4
- 0.9+: architecture decisions, critical bugs, security findings
- 0.7-0.8: reusable procedures, stable config facts
- 0.5-0.6: project-specific details, one-time fixes
- 0.3-0.4: session context, transient observations
- <0.3: trivial noise; prefer not extracting it at all
- split one session into multiple memories when it contains separate decisions, fixes, facts, procedures, or lessons
- do not merge unrelated facts into a single broad memory just because they happened in the same session
- extract concrete implementation details when they are likely to matter later: file paths, flags, defaults, thresholds, interfaces, failure modes, and follow-up steps
- include small but durable operational knowledge even if it feels mundane, as long as it would help a future engineer avoid re-discovery
- avoid duplicates that only rephrase the same point
- prefer 4-12 memories per useful session when the transcript contains multiple distinct durable points
- it is better to slightly over-extract than to miss reusable engineering knowledge
- do not store assistant suggestions as durable semantic/procedural memories unless the transcript shows they were applied, confirmed, tested, or adopted by the user
- set status to "proposed" for unverified suggestions, "observed" for facts seen in the transcript, "verified" for outcomes confirmed by test/build/deploy results
- do NOT extract version-check results (e.g. "codex version is 0.116.0"), model/session metadata (e.g. "using model X"), or transient environment context (timezone, cwd, shell) as standalone memories — only include them if they caused a real decision, bug, or workflow change
- do NOT create single-fact translation memories (e.g. "term X means Y") unless the translation was debated, corrected, or affects code behavior
- JSON only`;
}

export function wikiIngestPrompt(
  session: ParsedSession,
  schemaContent: string,
  indexContent: string,
  existingPages: string,
): string {
  const transcript = truncateMessages(session);

  return `You are a wiki maintainer. Review this session transcript together with the current wiki index, then decide which wiki pages should be created or updated.

Session from: ${session.source} (${session.timestamp.toISOString()})
Project: ${session.project ?? "unknown"}

SCHEMA:
${schemaContent}

CURRENT INDEX:
${indexContent || "(empty)"}

EXISTING PAGES:
${existingPages || "(none)"}

TRANSCRIPT:
${transcript}

Return a JSON array only. Each item must follow this format:
[
  {
    "action": "create" | "update",
    "type": "entity" | "concept" | "source" | "procedure" | "insight",
    "slug": "kebab-case-slug",
    "title": "page title",
    "content": "full markdown page content including YAML frontmatter and body",
    "reason": "why this page should be created or updated"
  }
]

Rules:
- Return [] when the session does not add durable information worth keeping.
- content must be the full page body, not a patch, because the system replaces the whole file.
- frontmatter must be YAML and include at least title, summary, tags, wikilinks, createdAt, and updatedAt.
- The page body should be cleaned up wiki prose, not raw chat transcript noise.
- When updating an existing page, preserve still-correct information and merge in the new facts from this session.
- Use the EXISTING PAGES context to merge updates instead of overwriting still-valid content.
- Keep slugs stable so the same topic does not split across duplicate pages.
- Use [[path-or-slug]] wikilinks syntax.`;
}

export function linkPrompt(newMemory: Memory, existingMemories: Memory[]): string {
  const existing = existingMemories
    .map((m) => `[${m.id}] (${m.layer}) ${m.title}: ${m.summary}`)
    .join("\n");

  return `You are a memory linker. Given a new memory and existing memories, find connections and contradictions.

NEW MEMORY:
Title: ${newMemory.title}
Layer: ${newMemory.layer}
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
}

Rules:
- link only memories that materially support, extend, or provide context for the new memory
- contradictions mean both memories cannot both be current/true without qualification
- keep the result conservative
- JSON only`;
}

export function linkBatchPrompt(items: Array<{ memory: Memory; candidates: Memory[] }>): string {
  const blocks = items
    .map(({ memory, candidates }) => {
      const candidateBlock = candidates
        .map((candidate) => `[${candidate.id}] (${candidate.layer}) ${candidate.title}: ${candidate.summary}`)
        .join("\n");

      return [
        `MEMORY ${memory.id}`,
        `title: ${memory.title}`,
        `layer: ${memory.layer}`,
        `summary: ${memory.summary}`,
        `details: ${memory.details}`,
        `tags: ${memory.tags.join(", ") || "(none)"}`,
        "CANDIDATES:",
        candidateBlock || "(none)",
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `You are a memory linker. For each memory below, choose only the strongest supporting links or contradictions from its candidate set.

${blocks}

Respond with JSON only:
[
  {
    "memory_id": "memory-id",
    "linked_ids": ["candidate-id"],
    "contradicts_ids": ["candidate-id"],
    "explanation": "brief reasoning"
  }
]

Rules:
- Only return entries for memories that have at least one real link or contradiction.
- linked_ids and contradicts_ids must only reference candidates listed under the same memory.
- Contradictions require a real conflict in current truth, not just a different perspective.
- Keep the result conservative and avoid speculative links.
- JSON only.`;
}

export function consolidatePrompt(memory: Memory, candidateMemories: Memory[]): string {
  const candidates = candidateMemories
    .map((candidate) => {
      return [
        `[${candidate.id}] (${candidate.layer}) ${candidate.title}`,
        `summary: ${candidate.summary}`,
        `details: ${candidate.details}`,
        `links: ${candidate.linkedMemoryIds.join(", ") || "(none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  return `You are a memory consolidator. Decide whether this new memory should reinforce existing durable knowledge or produce a new synthesized durable memory.

NEW MEMORY:
id: ${memory.id}
layer: ${memory.layer}
title: ${memory.title}
summary: ${memory.summary}
details: ${memory.details}
tags: ${memory.tags.join(", ")}
linked: ${memory.linkedMemoryIds.join(", ") || "(none)"}
contradicts: ${memory.contradicts.join(", ") || "(none)"}

EXISTING DURABLE CANDIDATES:
${candidates || "(none)"}

Respond with JSON:
{
  "action": "none" | "update-existing" | "create-synthesis",
  "target_id": "existing-memory-id-or-empty",
  "layer": "semantic" | "procedural" | "insight",
  "title": "title for updated or synthesized memory",
  "summary": "durable summary",
  "details": "durable merged details",
  "tags": ["tag1", "tag2"],
  "salience": 0.0,
  "linked_ids": ["memory ids that support this durable memory"],
  "reason": "brief explanation"
}

Rules:
- preserve episodic memories; this stage adds or updates durable knowledge, it does not delete the source memory
- use update-existing when an existing semantic/procedural/insight memory should be refreshed with the new evidence
- use create-synthesis when a new durable memory should be created from the new memory plus supporting context
- use none when the new memory is too isolated or not durable enough
- when a candidate title overlaps strongly with the new memory (text similarity > 0.8), prefer update-existing over creating another near-duplicate
- JSON only`;
}

export function consolidateBatchPrompt(items: Array<{ memory: Memory; candidates: Memory[] }>): string {
  const blocks = items
    .map(({ memory, candidates }) => {
      const candidateBlock = candidates
        .map((candidate) => {
          return [
            `[${candidate.id}] (${candidate.layer}) ${candidate.title}`,
            `summary: ${candidate.summary}`,
            `details: ${candidate.details}`,
            `links: ${candidate.linkedMemoryIds.join(", ") || "(none)"}`,
          ].join("\n");
        })
        .join("\n\n");

      return [
        `MEMORY ${memory.id}`,
        `layer: ${memory.layer}`,
        `title: ${memory.title}`,
        `summary: ${memory.summary}`,
        `details: ${memory.details}`,
        `tags: ${memory.tags.join(", ") || "(none)"}`,
        `linked: ${memory.linkedMemoryIds.join(", ") || "(none)"}`,
        `contradicts: ${memory.contradicts.join(", ") || "(none)"}`,
        "EXISTING DURABLE CANDIDATES:",
        candidateBlock || "(none)",
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `You are a memory consolidator. Decide whether each new memory below should reinforce existing durable knowledge or produce a new synthesized durable memory.

${blocks}

Respond with JSON only:
[
  {
    "memory_id": "new-memory-id",
    "action": "none" | "update-existing" | "create-synthesis",
    "target_id": "existing-memory-id-or-empty",
    "layer": "semantic" | "procedural" | "insight",
    "title": "title for updated or synthesized memory",
    "summary": "durable summary",
    "details": "durable merged details",
    "tags": ["tag1", "tag2"],
    "salience": 0.0,
    "linked_ids": ["memory ids that support this durable memory"],
    "reason": "brief explanation"
  }
]

Rules:
- Only return entries for memories that should update existing durable knowledge or create a synthesis.
- preserve episodic memories; this stage adds or updates durable knowledge, it does not delete the source memory
- use update-existing when an existing semantic/procedural/insight memory should be refreshed with the new evidence
- use create-synthesis when a new durable memory should be created from the new memory plus supporting context
- linked_ids and target_id must reference candidates listed under the same memory
- when a candidate title overlaps strongly with the new memory (text similarity > 0.8), choose update-existing instead of producing a duplicate durable memory
- Keep the result conservative and avoid speculative merges.
- JSON only.`;
}

export function reflectPrompt(memories: Memory[], context: Memory[] = []): string {
  const items = memories
    .map((memory) => {
      return [
        `[${memory.id}] (${memory.layer}) ${memory.title}`,
        `summary: ${memory.summary}`,
        `tags: ${memory.tags.join(", ") || "(none)"}`,
        `source_sessions: ${memory.sourceSessionIds.join(", ") || memory.sourceSessionId}`,
        `contradicts: ${memory.contradicts.join(", ") || "(none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  const contextBlock = context.length
    ? context
        .map((memory) => {
          return [
            `[${memory.id}] (${memory.layer}) ${memory.title}`,
            `summary: ${memory.summary}`,
            `tags: ${memory.tags.join(", ") || "(none)"}`,
            `source_sessions: ${memory.sourceSessionIds.join(", ") || memory.sourceSessionId}`,
          ].join("\n");
        })
        .join("\n\n")
    : "(none)";

  return `You are a reflection engine. Review these memories from the same processing batch and extract only durable insights that generalize beyond a single event.

MEMORIES:
${items}

HISTORICAL CONTEXT (recent durable memories for cross-session pattern detection):
${contextBlock}

Respond with JSON only:
[
  {
    "title": "insight title",
    "summary": "1-2 sentence insight",
    "details": "longer explanation, conditions, caveats, examples",
    "tags": ["tag1", "tag2"],
    "salience": 0.0,
    "linked_ids": ["supporting memory ids"]
  }
]

Rules:
- return [] if there is no real pattern
- prefer insights triggered by repeated evidence, contradictions, or stable engineering lessons
- do not restate a single episodic event as an insight
- Use historical context to detect patterns that span multiple sessions.
- only emit an insight when it is supported by at least 2 memories from different source sessions, or by the current batch plus historical context from another session
- do not elevate one-off sensor readings, recurring cron/sync success logs, or single-operation outcomes into insights
- if a candidate insight substantially overlaps historical context (>0.5 text similarity), skip it instead of restating the same lesson
- Do not simply restate historical context as new insights.
- JSON only`;
}

export function wikiSelectPagesPrompt(indexContent: string, question: string): string {
  return `You are a wiki navigator. Given the wiki index below and a user question, select the most relevant pages to answer the question.

WIKI INDEX:
${indexContent || "(empty)"}

QUESTION:
${question}

Respond with JSON only:
{
  "pages": ["entities/some-slug", "concepts/another-slug"]
}

Rules:
- Select 1-5 most relevant pages.
- Use the exact paths from the index (e.g. "entities/some-slug").
- If no pages are relevant, return {"pages": []}.`;
}

export function wikiAnswerPrompt(
  question: string,
  pageContents: Array<{ path: string; content: string }>,
): string {
  const pages = pageContents
    .map((p) => `--- ${p.path} ---\n${p.content}`)
    .join("\n\n");

  return `You are a knowledge assistant. Answer the question using the wiki pages provided below.

QUESTION:
${question}

WIKI PAGES:
${pages}

Rules:
- Base your answer only on the provided wiki pages.
- Reference sources using [[path]] notation (e.g. [[entities/some-tool]]).
- If the pages do not contain enough information, say so.
- Be concise and direct.`;
}

export function combinedQueryPrompt(
  question: string,
  memories: Array<{
    id: string;
    layer: string;
    title: string;
    summary: string;
    details: string;
    score: number;
    reasons: string[];
    sourceSessionId: string;
    sourceAgent: string;
  }>,
  wikiSources: WikiQuerySource[],
) {
  const memoryBlock = memories.length
    ? memories
        .map((memory) =>
          [
            `[${memory.id}] (${memory.layer}) ${memory.title}`,
            `summary: ${memory.summary}`,
            `details: ${memory.details}`,
            `score: ${memory.score.toFixed(3)} via ${memory.reasons.join(", ")}`,
            `source: ${memory.sourceAgent} / session ${memory.sourceSessionId}`,
          ].join("\n"),
        )
        .join("\n\n")
    : "(none)";

  const wikiBlock = wikiSources.length
    ? wikiSources
        .map((source) =>
          [
            `[${source.path}] ${source.title}`,
            `summary: ${source.summary || "(none)"}`,
            `updatedAt: ${source.updatedAt}`,
          ].join("\n"),
        )
        .join("\n\n")
    : "(none)";

  return `You are a knowledge synthesis assistant. Answer the user's question using both structured memories and curated wiki pages.

QUESTION:
${question}

MEMORIES:
${memoryBlock}

WIKI PAGES:
${wikiBlock}

Rules:
- Prefer the wiki when it is clearer and more stable.
- Use memories to add recency, specific evidence, and concrete examples.
- If memory and wiki disagree, say so plainly.
- Keep the answer concise but useful.
- End with a short "Confidence" line: high, medium, or low.
- Do not invent sources beyond the provided memory ids and wiki paths.`;
}
