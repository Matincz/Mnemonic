import { describe, expect, it } from "bun:test";
import {
  consolidateBatchPrompt,
  evaluatePrompt,
  ingestPrompt,
  reflectPrompt,
  truncateMessages,
  wikiIngestPrompt,
} from "../../src/llm/prompts";
import type { Memory, ParsedSession } from "../../src/types";

const session: ParsedSession = {
  id: "sess-1",
  source: "codex",
  timestamp: new Date("2026-04-16T00:00:00.000Z"),
  project: "mnemonic",
  rawPath: "/tmp/session.jsonl",
  messages: [
    { role: "user", content: "Fix auth and add stats command" },
    { role: "assistant", content: "Implemented auth fix and stats output" },
  ],
};

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: ["memory"],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date("2026-04-16T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-16T00:00:00.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    supportingMemoryIds: [],
    salience: 0.7,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

describe("prompts", () => {
  it("encourages remembering dense sessions with many small durable facts", () => {
    const prompt = evaluatePrompt(session);
    expect(prompt).toContain("multiple small durable facts");
    expect(prompt).toContain("architecture, config, defaults, edge cases");
    expect(prompt).toContain("repeated cron/sync execution logs");
    expect(prompt).toContain("pure environment context");
    expect(prompt).toContain("one-off sensor readings");
  });

  it("encourages higher extraction density for useful sessions", () => {
    const prompt = ingestPrompt(session);
    expect(prompt).toContain("prefer 4-12 memories per useful session");
    expect(prompt).toContain("slightly over-extract");
    expect(prompt).toContain("file paths, flags, defaults, thresholds");
    expect(prompt).toContain('set status to "proposed"');
    expect(prompt).toContain("assistant suggestions");
    expect(prompt).toContain("salience distribution target");
    expect(prompt).toContain("0.3-0.4");
    expect(prompt).toContain("trivial noise");
  });

  it("preserves opening context and recent tail when truncating long sessions", () => {
    const transcript = truncateMessages(
      {
        ...session,
        messages: [
          { role: "user", content: "Need to debug auth regression" },
          { role: "assistant", content: "Inspecting middleware and refresh flow" },
          { role: "user", content: "Collect prod logs and compare refresh token traces" },
          { role: "assistant", content: "Calling tools for auth log inspection" },
          { role: "tool", content: "bun test --filter auth" },
          { role: "user", content: "Check refresh rotation edge case after token exchange" },
          { role: "assistant", content: "filler ".repeat(120) },
          { role: "assistant", content: "Final fix: rotate refresh token after successful exchange" },
        ],
      },
      320,
    );

    expect(transcript).toContain("Need to debug auth regression");
    expect(transcript).toContain("Inspecting middleware and refresh flow");
    expect(transcript).toContain("Final fix: rotate refresh token");
    expect(transcript).toContain("... (truncated");
    expect(transcript).toContain("tool calls: 1");
    expect(transcript).toContain("... (skipped user prompts) ...");
    expect(transcript).toContain("Collect prod logs and compare refresh token traces");
    expect(transcript).not.toContain("filler filler filler filler filler filler filler filler");
  });

  it("keeps short code blocks and strips long generic code blocks", () => {
    const shortBlock = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
    const longBlock = Array.from({ length: 13 }, (_, index) => `line-${index}`).join("\n");

    const transcript = truncateMessages(
      {
        ...session,
        messages: [
          { role: "user", content: "share snippets" },
          {
            role: "assistant",
            content: `Short block:\n\`\`\`ts\n${shortBlock}\n\`\`\`\nLong block:\n\`\`\`ts\n${longBlock}\n\`\`\``,
          },
        ],
      },
      10000,
    );

    expect(transcript).toContain("Short block:");
    expect(transcript).toContain("a\nb\nc\nd\ne\nf\ng\nh\ni\nj");
    expect(transcript).toContain("`(code block omitted: 14 lines)`");
  });

  it("preserves long code blocks when whitelist keywords or error traces are present", () => {
    const whitelistBlock = Array.from({ length: 14 }, (_, index) =>
      index === 0 ? "schema: user_profile_v2" : `field_${index}: value`,
    ).join("\n");
    const errorBlock = Array.from({ length: 14 }, (_, index) =>
      index === 0 ? "Error: failed to compile template" : `at frame_${index}`,
    ).join("\n");

    const transcript = truncateMessages(
      {
        ...session,
        messages: [
          { role: "user", content: "show details" },
          {
            role: "assistant",
            content: `Whitelist:\n\`\`\`yaml\n${whitelistBlock}\n\`\`\`\nError:\n\`\`\`txt\n${errorBlock}\n\`\`\``,
          },
        ],
      },
      10000,
    );

    expect(transcript).toContain("schema: user_profile_v2");
    expect(transcript).toContain("Error: failed to compile template");
    expect(transcript).not.toContain("code block omitted");
  });

  it("includes historical context when building reflect prompts", () => {
    const prompt = reflectPrompt(
      [makeMemory("current-1"), makeMemory("current-2", { layer: "episodic" })],
      [makeMemory("history-1", { layer: "insight", title: "Repeated auth failures" })],
    );

    expect(prompt).toContain("HISTORICAL CONTEXT");
    expect(prompt).toContain("Repeated auth failures");
    expect(prompt).toContain("span multiple sessions");
    expect(prompt).toContain("source_sessions:");
    expect(prompt).toContain("different source sessions");
    expect(prompt).toContain("cron/sync success logs");
    expect(prompt).toContain("salience generally >= 0.5");
  });

  it("includes existing wiki pages for merge-aware updates", () => {
    const prompt = wikiIngestPrompt(
      session,
      "# schema",
      "# index",
      "[[concepts/auth-flow]]\nsummary: Existing auth flow page",
    );

    expect(prompt).toContain("EXISTING PAGES");
    expect(prompt).toContain("Existing auth flow page");
    expect(prompt).toContain("merge updates instead of overwriting");
  });

  it("builds batch consolidation prompts for multiple memories", () => {
    const prompt = consolidateBatchPrompt([
      {
        memory: makeMemory("new-1", { title: "Refresh token rotation" }),
        candidates: [makeMemory("durable-1", { layer: "procedural", title: "Auth rotation procedure" })],
      },
      {
        memory: makeMemory("new-2", { title: "Retry strategy" }),
        candidates: [makeMemory("durable-2", { layer: "insight", title: "Retry lessons" })],
      },
    ]);

    expect(prompt).toContain("MEMORY new-1");
    expect(prompt).toContain("MEMORY new-2");
    expect(prompt).toContain("Auth rotation procedure");
    expect(prompt).toContain('"memory_id": "new-memory-id"');
    expect(prompt).toContain("text similarity > 0.8");
    expect(prompt).toContain("choose update-existing");
  });
});
