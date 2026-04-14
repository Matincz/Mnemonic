# Memory Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daemon that watches AI agent session files (Codex, Claude Code, Gemini CLI, OpenCode, OpenClaw, Amp), extracts important information via LLM, and organizes it into a layered memory system (episodic/semantic/procedural/insight) stored as Markdown + SQLite + LanceDB.

**Architecture:** An event-driven Bun daemon uses `fs.watch` to detect new/modified session files from 6 agent sources. Each session passes through a state machine (Evaluating → Ingesting → Linking → Consolidating → Reflecting). Extracted memories are stored in a Markdown vault (human-readable, Obsidian-compatible), indexed in SQLite (metadata/search), and embedded in LanceDB (vector similarity). An Ink-based TUI provides interactive access.

**Tech Stack:** Bun (runtime), TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/openai`), better-sqlite3 (metadata), @lancedb/lancedb (vectors), Ink + React (TUI), Zod (validation)

---

## File Structure

```
memory-agent/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── index.ts                    # Daemon entry point
│   ├── config.ts                   # Paths, env, constants
│   ├── types.ts                    # Shared type definitions
│   ├── parsers/
│   │   ├── index.ts                # Parser registry
│   │   ├── base.ts                 # Base parser interface
│   │   ├── codex.ts                # Codex JSONL parser
│   │   ├── claude-code.ts          # Claude Code JSONL parser
│   │   ├── gemini.ts               # Gemini CLI JSON parser
│   │   ├── opencode.ts             # OpenCode SQLite parser
│   │   ├── openclaw.ts             # OpenClaw JSONL parser
│   │   └── amp.ts                  # Amp thread parser (via CLI)
│   ├── watcher/
│   │   ├── index.ts                # Unified watcher orchestrator
│   │   ├── fs-watcher.ts           # fs.watch wrapper with debounce
│   │   └── state.ts                # Tracks processed files (dedup)
│   ├── pipeline/
│   │   ├── index.ts                # Pipeline orchestrator (state machine)
│   │   ├── evaluator.ts            # Stage 1: Is it worth remembering?
│   │   ├── ingestor.ts             # Stage 2: Extract structured memories
│   │   ├── linker.ts               # Stage 3: Connect & detect conflicts
│   │   ├── consolidator.ts         # Stage 4: Merge fragments
│   │   └── reflector.ts            # Stage 5: Find patterns
│   ├── storage/
│   │   ├── index.ts                # Storage facade
│   │   ├── markdown.ts             # Markdown vault writer
│   │   ├── sqlite.ts               # SQLite metadata index
│   │   └── vector.ts               # LanceDB embeddings
│   ├── llm/
│   │   ├── index.ts                # LLM client (Vercel AI SDK)
│   │   └── prompts.ts              # All LLM prompt templates
│   └── tui/
│       ├── index.tsx               # TUI entry point
│       ├── app.tsx                  # Root Ink component
│       ├── components/
│       │   ├── timeline.tsx         # Timeline view
│       │   ├── search.tsx           # Search view
│       │   ├── detail.tsx           # Memory detail view
│       │   └── status.tsx           # Daemon status bar
│       └── hooks/
│           └── use-memory.ts        # Data hooks
├── vault/                          # Markdown memory vault (generated)
│   ├── index.md
│   ├── episodic/
│   ├── semantic/
│   ├── procedural/
│   └── insight/
├── data/                           # SQLite + LanceDB data (generated)
└── tests/
    ├── parsers/
    │   ├── codex.test.ts
    │   ├── claude-code.test.ts
    │   ├── gemini.test.ts
    │   ├── opencode.test.ts
    │   ├── openclaw.test.ts
    │   └── amp.test.ts
    ├── pipeline/
    │   ├── evaluator.test.ts
    │   └── pipeline.test.ts
    ├── storage/
    │   ├── markdown.test.ts
    │   └── sqlite.test.ts
    └── fixtures/
        ├── codex-session.jsonl
        ├── claude-session.jsonl
        ├── gemini-session.json
        ├── opencode-messages.json
        └── openclaw-session.jsonl
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `src/config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "memory-agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "tui": "bun run src/tui/index.tsx",
    "test": "bun test"
  },
  "dependencies": {
    "ai": "^4.3.0",
    "@ai-sdk/openai": "^1.3.0",
    "better-sqlite3": "^11.8.0",
    "@lancedb/lancedb": "^0.15.0",
    "ink": "^5.1.0",
    "react": "^18.3.1",
    "zod": "^3.24.0",
    "nanoid": "^5.1.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/bun": "^1.2.6",
    "@types/react": "^18.3.18"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create bunfig.toml**

```toml
[test]
preload = []
```

- [ ] **Step 4: Create src/config.ts**

```typescript
import { homedir } from "os";
import { join } from "path";

const HOME = homedir();

export const config = {
  /** Where each agent stores sessions */
  sources: {
    codex: join(HOME, ".codex/sessions"),
    claudeCode: join(HOME, ".claude/projects"),
    gemini: join(HOME, ".gemini/tmp"),
    opencode: join(HOME, ".local/share/opencode/opencode.db"),
    openclaw: join(HOME, ".openclaw/agents"),
    amp: "amp-cli", // accessed via `amp threads` CLI
  },

  /** Where memory-agent stores its output */
  vault: join(HOME, "Desktop/Memory agent/vault"),
  dataDir: join(HOME, "Desktop/Memory agent/data"),
  sqlitePath: join(HOME, "Desktop/Memory agent/data/memory.db"),
  lanceDir: join(HOME, "Desktop/Memory agent/data/lance"),

  /** Processing */
  watchDebounceMs: 2000,
  maxSessionAgeDays: 7, // only process sessions newer than this
  llmModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small",
} as const;
```

- [ ] **Step 5: Create src/types.ts**

```typescript
import { z } from "zod";

/** The source agent */
export type AgentSource = "codex" | "claude-code" | "gemini" | "opencode" | "openclaw" | "amp";

/** Memory layers */
export type MemoryLayer = "episodic" | "semantic" | "procedural" | "insight";

/** Progressive disclosure levels */
export type DisclosureLevel = "L0" | "L1" | "L2" | "L3";

/** A raw parsed session before LLM processing */
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

/** A single extracted memory unit */
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
  salience: z.number().min(0).max(1),
  linkedMemoryIds: z.array(z.string()),
  contradicts: z.array(z.string()),
});

export type Memory = z.infer<typeof MemorySchema>;

/** Pipeline stages */
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
}

/** Processed session tracking (for dedup) */
export interface ProcessedFile {
  path: string;
  hash: string;
  processedAt: string;
  sessionId: string;
}
```

- [ ] **Step 6: Install dependencies**

Run: `bun install`
Expected: All packages installed, `node_modules` and `bun.lockb` created.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git init
git add package.json tsconfig.json bunfig.toml src/config.ts src/types.ts
git commit -m "feat: scaffold project with types and config"
```

---

### Task 2: Session Parsers — Codex

**Files:**
- Create: `src/parsers/base.ts`
- Create: `src/parsers/codex.ts`
- Create: `tests/fixtures/codex-session.jsonl`
- Create: `tests/parsers/codex.test.ts`

- [ ] **Step 1: Create base parser interface**

```typescript
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
```

- [ ] **Step 2: Create test fixture**

Take a real Codex JSONL and create a minimal fixture. The Codex format is one JSON object per line, with fields: `timestamp`, `type` ("response_item"), `payload` containing `role` and `content` array. Content items have `type: "input_text"` with a `text` field.

```jsonl
{"timestamp":"2026-04-13T03:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"How do I configure the database?"}]}}
{"timestamp":"2026-04-13T03:00:05.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"You can configure the database by editing config/database.yml. Set the adapter to postgresql and provide the connection URL."}]}}
{"timestamp":"2026-04-13T03:00:10.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"What about connection pooling?"}]}}
{"timestamp":"2026-04-13T03:00:15.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Add pool: 10 and timeout: 5000 to the database config. For production, consider pgbouncer for external pooling."}]}}
```

Save as `tests/fixtures/codex-session.jsonl`

- [ ] **Step 3: Write the failing test**

```typescript
// tests/parsers/codex.test.ts
import { describe, it, expect } from "bun:test";
import { CodexParser } from "../../src/parsers/codex";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/codex-session.jsonl");

describe("CodexParser", () => {
  const parser = new CodexParser();

  it("parses JSONL into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("codex");
    expect(session!.messages).toHaveLength(4);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("configure the database");
    expect(session!.messages[1].role).toBe("assistant");
    expect(session!.timestamp).toBeInstanceOf(Date);
  });

  it("returns watch paths", () => {
    const paths = parser.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(".codex/sessions");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/parsers/codex.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement CodexParser**

```typescript
// src/parsers/codex.ts
import { readFile } from "fs/promises";
import { basename } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

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

  async parse(filePath: string): Promise<ParsedSession | null> {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messages: SessionMessage[] = [];
    let firstTimestamp: Date | null = null;

    for (const line of lines) {
      let entry: CodexEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

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
    return [config.sources.codex];
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/parsers/codex.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/parsers/base.ts src/parsers/codex.ts tests/parsers/codex.test.ts tests/fixtures/codex-session.jsonl
git commit -m "feat: add Codex session parser"
```

---

### Task 3: Session Parsers — Claude Code

**Files:**
- Create: `src/parsers/claude-code.ts`
- Create: `tests/fixtures/claude-session.jsonl`
- Create: `tests/parsers/claude-code.test.ts`

- [ ] **Step 1: Create test fixture**

Claude Code JSONL has entries with `type` field. Important types: `"user"` messages with `message.content` array containing `{type: "text", text: "..."}`, and assistant responses. Entries also have `parentUuid`, `uuid`, `timestamp`, `sessionId`. Many entries are hook/attachment types to ignore.

```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"How do I fix the CORS issue?"}]},"uuid":"aaa-111","timestamp":"2026-04-11T10:00:00.000Z","sessionId":"session-1","cwd":"/Users/test/my-project"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Add the cors middleware to your Express app:\n\nimport cors from 'cors';\napp.use(cors({ origin: 'http://localhost:3000' }));"}]},"uuid":"aaa-222","timestamp":"2026-04-11T10:00:05.000Z","sessionId":"session-1","cwd":"/Users/test/my-project"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"What about for production?"}]},"uuid":"aaa-333","timestamp":"2026-04-11T10:00:10.000Z","sessionId":"session-1","cwd":"/Users/test/my-project"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Use an allowlist of origins. Set origin to an array of trusted domains."}]},"uuid":"aaa-444","timestamp":"2026-04-11T10:00:15.000Z","sessionId":"session-1","cwd":"/Users/test/my-project"}
```

Save as `tests/fixtures/claude-session.jsonl`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/parsers/claude-code.test.ts
import { describe, it, expect } from "bun:test";
import { ClaudeCodeParser } from "../../src/parsers/claude-code";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/claude-session.jsonl");

describe("ClaudeCodeParser", () => {
  const parser = new ClaudeCodeParser();

  it("parses JSONL into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("claude-code");
    expect(session!.messages).toHaveLength(4);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("CORS");
  });

  it("extracts project from cwd", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session!.project).toBe("my-project");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/parsers/claude-code.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement ClaudeCodeParser**

```typescript
// src/parsers/claude-code.ts
import { readFile } from "fs/promises";
import { basename, dirname } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface ClaudeEntry {
  type: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
}

export class ClaudeCodeParser implements SessionParser {
  name = "claude-code";

  async parse(filePath: string): Promise<ParsedSession | null> {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messages: SessionMessage[] = [];
    let firstTimestamp: Date | null = null;
    let project: string | undefined;

    for (const line of lines) {
      let entry: ClaudeEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      // Only process user/assistant message entries
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      if (!entry.message?.content) continue;

      const textParts = entry.message.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      if (textParts.length === 0) continue;

      const role = entry.message.role as SessionMessage["role"];
      const ts = entry.timestamp ? new Date(entry.timestamp) : undefined;
      if (ts && !firstTimestamp) firstTimestamp = ts;

      // Extract project name from cwd
      if (!project && entry.cwd) {
        project = basename(entry.cwd);
      }

      messages.push({ role, content: textParts.join("\n"), timestamp: ts });
    }

    if (messages.length === 0) return null;

    const sessionName = basename(filePath, ".jsonl");
    return {
      id: `claude-${sessionName}`,
      source: "claude-code",
      timestamp: firstTimestamp ?? new Date(),
      project,
      messages,
      rawPath: filePath,
    };
  }

  watchPaths(): string[] {
    return [config.sources.claudeCode];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/parsers/claude-code.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/parsers/claude-code.ts tests/parsers/claude-code.test.ts tests/fixtures/claude-session.jsonl
git commit -m "feat: add Claude Code session parser"
```

---

### Task 4: Session Parsers — Gemini CLI

**Files:**
- Create: `src/parsers/gemini.ts`
- Create: `tests/fixtures/gemini-session.json`
- Create: `tests/parsers/gemini.test.ts`

- [ ] **Step 1: Create test fixture**

Gemini stores standard JSON with `sessionId`, `messages` array. Each message has `type` ("user" | "gemini"), `content` (string for gemini, array of `{text}` for user), and optional `thoughts`.

```json
{
  "sessionId": "test-gemini-session",
  "projectHash": "abc123",
  "startTime": "2026-04-12T08:00:00.000Z",
  "lastUpdated": "2026-04-12T08:05:00.000Z",
  "messages": [
    {
      "id": "msg-1",
      "timestamp": "2026-04-12T08:00:00.000Z",
      "type": "user",
      "content": [{ "text": "Explain the singleton pattern" }]
    },
    {
      "id": "msg-2",
      "timestamp": "2026-04-12T08:00:05.000Z",
      "type": "gemini",
      "content": "The singleton pattern ensures a class has only one instance. Use a static getInstance() method that creates the instance on first call and returns it on subsequent calls.",
      "thoughts": [
        {
          "subject": "Design Patterns",
          "description": "Explaining singleton with practical guidance",
          "timestamp": "2026-04-12T08:00:04.000Z"
        }
      ],
      "model": "gemini-2.5-flash"
    }
  ],
  "kind": "main"
}
```

Save as `tests/fixtures/gemini-session.json`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/parsers/gemini.test.ts
import { describe, it, expect } from "bun:test";
import { GeminiParser } from "../../src/parsers/gemini";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/gemini-session.json");

describe("GeminiParser", () => {
  const parser = new GeminiParser();

  it("parses JSON into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("gemini");
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("singleton");
    expect(session!.messages[1].role).toBe("assistant");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/parsers/gemini.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement GeminiParser**

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/parsers/gemini.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/parsers/gemini.ts tests/parsers/gemini.test.ts tests/fixtures/gemini-session.json
git commit -m "feat: add Gemini CLI session parser"
```

---

### Task 5: Session Parsers — OpenCode

**Files:**
- Create: `src/parsers/opencode.ts`
- Create: `tests/fixtures/opencode-messages.json`
- Create: `tests/parsers/opencode.test.ts`

- [ ] **Step 1: Create test fixture**

OpenCode stores data in SQLite. The `session` table has `id`, `title`, `directory`, `time_created`, `time_updated`. The `message` table has `id`, `session_id`, `data` (JSON string), `time_created`. The `data` field contains `{"role": "user"|"assistant", ...}`.

For testing, we create a JSON fixture representing extracted messages since we can't bundle a SQLite file easily:

```json
[
  {
    "sessionId": "test-opencode-session",
    "title": "Database Migration",
    "directory": "/Users/test/my-app",
    "timeCreated": 1773376399000,
    "messages": [
      { "role": "user", "content": "Help me write a database migration", "timeCreated": 1773376399000 },
      { "role": "assistant", "content": "Create a migration file using drizzle-kit generate. Then run drizzle-kit push to apply it.", "timeCreated": 1773376404000 }
    ]
  }
]
```

Save as `tests/fixtures/opencode-messages.json`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/parsers/opencode.test.ts
import { describe, it, expect } from "bun:test";
import { OpenCodeParser } from "../../src/parsers/opencode";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/opencode-messages.json");

describe("OpenCodeParser", () => {
  const parser = new OpenCodeParser();

  it("parses sessions from fixture data", async () => {
    // Test the internal extraction logic with fixture data
    const raw = await Bun.file(FIXTURE).json();
    const sessions = parser.convertRawSessions(raw);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].source).toBe("opencode");
    expect(sessions[0].messages).toHaveLength(2);
    expect(sessions[0].messages[0].content).toContain("database migration");
    expect(sessions[0].project).toBe("my-app");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/parsers/opencode.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement OpenCodeParser**

```typescript
// src/parsers/opencode.ts
import Database from "better-sqlite3";
import { basename } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface RawOpenCodeSession {
  sessionId: string;
  title: string;
  directory: string;
  timeCreated: number;
  messages: Array<{ role: string; content: string; timeCreated: number }>;
}

export class OpenCodeParser implements SessionParser {
  name = "opencode";

  /** Parse directly from the SQLite database */
  async parse(dbPath: string): Promise<ParsedSession | null> {
    // For OpenCode we return the most recent session
    const sessions = this.readFromDb(dbPath);
    return sessions[0] ?? null;
  }

  /** Read all recent sessions from the database */
  readFromDb(dbPath: string): ParsedSession[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      const cutoff = Date.now() - config.maxSessionAgeDays * 86400_000;

      const rows = db.prepare(`
        SELECT s.id, s.title, s.directory, s.time_created,
               m.data, m.time_created as msg_time
        FROM session s
        JOIN message m ON m.session_id = s.id
        WHERE s.time_updated > ?
        ORDER BY s.time_created DESC, m.time_created ASC
      `).all(cutoff) as Array<{
        id: string; title: string; directory: string;
        time_created: number; data: string; msg_time: number;
      }>;

      // Group by session
      const grouped = new Map<string, { session: any; messages: any[] }>();
      for (const row of rows) {
        if (!grouped.has(row.id)) {
          grouped.set(row.id, {
            session: row,
            messages: [],
          });
        }
        try {
          const msgData = JSON.parse(row.data);
          if (msgData.role === "user" || msgData.role === "assistant") {
            grouped.get(row.id)!.messages.push({
              role: msgData.role,
              content: typeof msgData.content === "string"
                ? msgData.content
                : JSON.stringify(msgData.content),
              timeCreated: row.msg_time,
            });
          }
        } catch {}
      }

      return this.convertRawSessions(
        [...grouped.values()].map((g) => ({
          sessionId: g.session.id,
          title: g.session.title,
          directory: g.session.directory,
          timeCreated: g.session.time_created,
          messages: g.messages,
        }))
      );
    } finally {
      db.close();
    }
  }

  /** Convert raw session data to ParsedSession array (also used in tests) */
  convertRawSessions(raw: RawOpenCodeSession[]): ParsedSession[] {
    return raw.map((s) => ({
      id: `opencode-${s.sessionId}`,
      source: "opencode" as const,
      timestamp: new Date(s.timeCreated),
      project: basename(s.directory),
      messages: s.messages.map((m) => ({
        role: m.role as SessionMessage["role"],
        content: m.content,
        timestamp: new Date(m.timeCreated),
      })),
      rawPath: config.sources.opencode,
    }));
  }

  watchPaths(): string[] {
    return [config.sources.opencode];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/parsers/opencode.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/parsers/opencode.ts tests/parsers/opencode.test.ts tests/fixtures/opencode-messages.json
git commit -m "feat: add OpenCode session parser"
```

---

### Task 6: Session Parsers — OpenClaw

**Files:**
- Create: `src/parsers/openclaw.ts`
- Create: `tests/fixtures/openclaw-session.jsonl`
- Create: `tests/parsers/openclaw.test.ts`

- [ ] **Step 1: Create test fixture**

OpenClaw JSONL has a `type` field: `"session"` (header), `"message"` (user/assistant), `"model_change"`, `"thinking_level_change"`, `"custom"`. Messages have `message.role` and `message.content` array.

```jsonl
{"type":"session","version":3,"id":"test-openclaw-session","timestamp":"2026-03-11T14:00:00.000Z","cwd":"/Users/test/iot-project"}
{"type":"message","id":"msg-1","parentId":null,"timestamp":"2026-03-11T14:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"How do I set up MQTT in Node.js?"}]}}
{"type":"message","id":"msg-2","parentId":"msg-1","timestamp":"2026-03-11T14:00:10.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Install the mqtt package:\n\nnpm install mqtt\n\nThen create a client:\n\nimport mqtt from 'mqtt';\nconst client = mqtt.connect('mqtt://broker.local');"}]}}
```

Save as `tests/fixtures/openclaw-session.jsonl`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/parsers/openclaw.test.ts
import { describe, it, expect } from "bun:test";
import { OpenClawParser } from "../../src/parsers/openclaw";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "../fixtures/openclaw-session.jsonl");

describe("OpenClawParser", () => {
  const parser = new OpenClawParser();

  it("parses JSONL into ParsedSession", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("openclaw");
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0].content).toContain("MQTT");
    expect(session!.id).toBe("openclaw-test-openclaw-session");
  });

  it("extracts project from session cwd", async () => {
    const session = await parser.parse(FIXTURE);
    expect(session!.project).toBe("iot-project");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/parsers/openclaw.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement OpenClawParser**

```typescript
// src/parsers/openclaw.ts
import { readFile } from "fs/promises";
import { basename } from "path";
import { config } from "../config";
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

interface OpenClawEntry {
  type: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
}

export class OpenClawParser implements SessionParser {
  name = "openclaw";

  async parse(filePath: string): Promise<ParsedSession | null> {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messages: SessionMessage[] = [];
    let sessionId = "";
    let firstTimestamp: Date | null = null;
    let project: string | undefined;

    for (const line of lines) {
      let entry: OpenClawEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "session") {
        sessionId = entry.id ?? basename(filePath, ".jsonl");
        if (entry.cwd) project = basename(entry.cwd);
        if (entry.timestamp) firstTimestamp = new Date(entry.timestamp);
        continue;
      }

      if (entry.type !== "message") continue;
      if (!entry.message?.content) continue;

      const textParts = entry.message.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      if (textParts.length === 0) continue;

      const ts = entry.timestamp ? new Date(entry.timestamp) : undefined;
      if (ts && !firstTimestamp) firstTimestamp = ts;

      messages.push({
        role: entry.message.role as SessionMessage["role"],
        content: textParts.join("\n"),
        timestamp: ts,
      });
    }

    if (messages.length === 0) return null;

    return {
      id: `openclaw-${sessionId}`,
      source: "openclaw",
      timestamp: firstTimestamp ?? new Date(),
      project,
      messages,
      rawPath: filePath,
    };
  }

  watchPaths(): string[] {
    return [config.sources.openclaw];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/parsers/openclaw.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/parsers/openclaw.ts tests/parsers/openclaw.test.ts tests/fixtures/openclaw-session.jsonl
git commit -m "feat: add OpenClaw session parser"
```

---

### Task 7: Session Parsers — Amp

**Files:**
- Create: `src/parsers/amp.ts`
- Create: `tests/parsers/amp.test.ts`

- [ ] **Step 1: Write the failing test**

Amp sessions are accessed via `amp threads markdown <thread-id>` CLI. We test the parsing of markdown output.

```typescript
// tests/parsers/amp.test.ts
import { describe, it, expect } from "bun:test";
import { AmpParser } from "../../src/parsers/amp";

const SAMPLE_MD = `---
title: Fix auth bug
threadId: T-019d0000-0000-0000-0000-000000000001
created: 2026-04-12T10:00:00.000Z
agentMode: smart
---

# Fix auth bug

## User

How do I fix the JWT refresh token issue?

## Assistant

The issue is that the refresh token is not being rotated on each use. Update the auth middleware to issue a new refresh token on every successful refresh.

## User

Can you show me the code?

## Assistant

Here is the updated middleware code...
`;

describe("AmpParser", () => {
  const parser = new AmpParser();

  it("parses markdown into ParsedSession", () => {
    const session = parser.parseMarkdown(SAMPLE_MD, "T-019d0000-0000-0000-0000-000000000001");
    expect(session).not.toBeNull();
    expect(session!.source).toBe("amp");
    expect(session!.messages).toHaveLength(4);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("JWT");
    expect(session!.messages[1].role).toBe("assistant");
    expect(session!.id).toContain("amp-");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/parsers/amp.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement AmpParser**

```typescript
// src/parsers/amp.ts
import type { ParsedSession, SessionMessage } from "../types";
import type { SessionParser } from "./base";

export class AmpParser implements SessionParser {
  name = "amp";

  /** Parse by calling `amp threads markdown <id>` */
  async parse(threadId: string): Promise<ParsedSession | null> {
    try {
      const proc = Bun.spawn(["amp", "threads", "markdown", threadId, "--no-color"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      if (!output.trim()) return null;
      return this.parseMarkdown(output, threadId);
    } catch {
      return null;
    }
  }

  /** Parse the markdown output from `amp threads markdown` */
  parseMarkdown(md: string, threadId: string): ParsedSession | null {
    // Extract frontmatter
    const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
    let created: Date = new Date();
    let title = "";
    if (fmMatch) {
      const fm = fmMatch[1];
      const createdMatch = fm.match(/created:\s*(.+)/);
      if (createdMatch) created = new Date(createdMatch[1]);
      const titleMatch = fm.match(/title:\s*(.+)/);
      if (titleMatch) title = titleMatch[1].trim();
    }

    // Split on ## User / ## Assistant headers
    const body = fmMatch ? md.slice(fmMatch[0].length) : md;
    const sections = body.split(/^## (User|Assistant)/m).slice(1);

    const messages: SessionMessage[] = [];
    for (let i = 0; i < sections.length - 1; i += 2) {
      const role = sections[i].trim().toLowerCase() === "user" ? "user" : "assistant";
      const content = sections[i + 1].trim();
      if (content) {
        messages.push({ role: role as SessionMessage["role"], content });
      }
    }

    if (messages.length === 0) return null;

    return {
      id: `amp-${threadId}`,
      source: "amp",
      timestamp: created,
      project: title || undefined,
      messages,
      rawPath: `amp:${threadId}`,
    };
  }

  /** Amp threads are listed via CLI, not watched via fs */
  watchPaths(): string[] {
    return [];
  }

  /** List recent thread IDs */
  async listRecentThreads(): Promise<string[]> {
    try {
      const proc = Bun.spawn(["amp", "threads", "list", "--no-color"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      const ids: string[] = [];
      for (const line of output.split("\n")) {
        const match = line.match(/(T-[0-9a-f-]+)/);
        if (match) ids.push(match[1]);
      }
      return ids;
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/parsers/amp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/parsers/amp.ts tests/parsers/amp.test.ts
git commit -m "feat: add Amp thread parser"
```

---

### Task 8: Parser Registry

**Files:**
- Create: `src/parsers/index.ts`

- [ ] **Step 1: Create parser registry**

```typescript
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
```

- [ ] **Step 2: Verify all tests pass**

Run: `bun test`
Expected: All parser tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/parsers/index.ts
git commit -m "feat: add parser registry"
```

---

### Task 9: SQLite Storage Layer

**Files:**
- Create: `src/storage/sqlite.ts`
- Create: `tests/storage/sqlite.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/storage/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MemoryDB } from "../../src/storage/sqlite";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import type { Memory } from "../../src/types";

const TEST_DB = join(import.meta.dir, "test-memory.db");

describe("MemoryDB", () => {
  let db: MemoryDB;

  beforeEach(() => {
    db = new MemoryDB(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  const makeMemory = (overrides: Partial<Memory> = {}): Memory => ({
    id: "mem-1",
    layer: "episodic",
    title: "Fixed auth bug",
    summary: "Fixed JWT refresh token rotation",
    details: "Updated middleware to rotate refresh tokens",
    tags: ["auth", "jwt"],
    project: "my-app",
    sourceSessionId: "codex-abc123",
    sourceAgent: "codex",
    createdAt: new Date().toISOString(),
    salience: 0.8,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  });

  it("inserts and retrieves a memory", () => {
    const mem = makeMemory();
    db.upsertMemory(mem);
    const result = db.getMemory("mem-1");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Fixed auth bug");
    expect(result!.tags).toEqual(["auth", "jwt"]);
  });

  it("searches memories by text", () => {
    db.upsertMemory(makeMemory({ id: "mem-1", title: "Auth fix" }));
    db.upsertMemory(makeMemory({ id: "mem-2", title: "DB migration", summary: "Migrated postgres" }));
    const results = db.searchMemories("auth");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("Auth fix");
  });

  it("tracks processed files", () => {
    db.markFileProcessed("/path/to/file", "hash123", "session-1");
    expect(db.isFileProcessed("/path/to/file", "hash123")).toBe(true);
    expect(db.isFileProcessed("/path/to/file", "hash456")).toBe(false);
  });

  it("lists memories by layer", () => {
    db.upsertMemory(makeMemory({ id: "m1", layer: "episodic" }));
    db.upsertMemory(makeMemory({ id: "m2", layer: "semantic" }));
    db.upsertMemory(makeMemory({ id: "m3", layer: "episodic" }));
    const episodic = db.listByLayer("episodic");
    expect(episodic).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/storage/sqlite.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MemoryDB**

```typescript
// src/storage/sqlite.ts
import Database from "better-sqlite3";
import type { Memory, MemoryLayer } from "../types";

export class MemoryDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT,
        source_session_id TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        salience REAL NOT NULL DEFAULT 0.5,
        linked_memory_ids TEXT NOT NULL DEFAULT '[]',
        contradicts TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS processed_files (
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT NOT NULL,
        PRIMARY KEY (path, hash)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_agent);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_salience ON memories(salience DESC);
    `);
  }

  upsertMemory(mem: Memory) {
    this.db.prepare(`
      INSERT OR REPLACE INTO memories
      (id, layer, title, summary, details, tags, project,
       source_session_id, source_agent, created_at, salience,
       linked_memory_ids, contradicts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mem.id, mem.layer, mem.title, mem.summary, mem.details,
      JSON.stringify(mem.tags), mem.project ?? null,
      mem.sourceSessionId, mem.sourceAgent, mem.createdAt, mem.salience,
      JSON.stringify(mem.linkedMemoryIds), JSON.stringify(mem.contradicts)
    );
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    return row ? this.rowToMemory(row) : null;
  }

  searchMemories(query: string, limit = 20): Memory[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE title LIKE ? OR summary LIKE ? OR details LIKE ?
      ORDER BY salience DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  listByLayer(layer: MemoryLayer, limit = 50): Memory[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories WHERE layer = ? ORDER BY created_at DESC LIMIT ?"
    ).all(layer, limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  listRecent(limit = 50): Memory[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  markFileProcessed(path: string, hash: string, sessionId: string) {
    this.db.prepare(
      "INSERT OR REPLACE INTO processed_files (path, hash, session_id) VALUES (?, ?, ?)"
    ).run(path, hash, sessionId);
  }

  isFileProcessed(path: string, hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM processed_files WHERE path = ? AND hash = ?"
    ).get(path, hash);
    return !!row;
  }

  close() {
    this.db.close();
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      layer: row.layer,
      title: row.title,
      summary: row.summary,
      details: row.details,
      tags: JSON.parse(row.tags),
      project: row.project ?? undefined,
      sourceSessionId: row.source_session_id,
      sourceAgent: row.source_agent,
      createdAt: row.created_at,
      salience: row.salience,
      linkedMemoryIds: JSON.parse(row.linked_memory_ids),
      contradicts: JSON.parse(row.contradicts),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/storage/sqlite.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/sqlite.ts tests/storage/sqlite.test.ts
git commit -m "feat: add SQLite memory storage"
```

---

### Task 10: Markdown Vault Writer

**Files:**
- Create: `src/storage/markdown.ts`
- Create: `tests/storage/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/storage/markdown.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MarkdownVault } from "../../src/storage/markdown";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import type { Memory } from "../../src/types";

const TEST_VAULT = join(import.meta.dir, "test-vault");

describe("MarkdownVault", () => {
  let vault: MarkdownVault;

  beforeEach(() => {
    vault = new MarkdownVault(TEST_VAULT);
  });

  afterEach(() => {
    if (existsSync(TEST_VAULT)) rmSync(TEST_VAULT, { recursive: true });
  });

  const makeMemory = (): Memory => ({
    id: "mem-test-1",
    layer: "episodic",
    title: "Fixed auth bug",
    summary: "Fixed JWT refresh token rotation in the auth middleware",
    details: "Updated the auth middleware to rotate refresh tokens on each use, preventing token replay attacks.",
    tags: ["auth", "jwt", "security"],
    project: "my-app",
    sourceSessionId: "codex-abc123",
    sourceAgent: "codex",
    createdAt: "2026-04-13T10:00:00.000Z",
    salience: 0.85,
    linkedMemoryIds: ["mem-old-1"],
    contradicts: [],
  });

  it("writes a memory as markdown with frontmatter", () => {
    vault.writeMemory(makeMemory());
    const filePath = join(TEST_VAULT, "episodic", "mem-test-1.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("title: Fixed auth bug");
    expect(content).toContain("tags:");
    expect(content).toContain("- auth");
    expect(content).toContain("## Summary");
    expect(content).toContain("JWT refresh token");
  });

  it("creates index.md", () => {
    vault.writeMemory(makeMemory());
    vault.rebuildIndex([makeMemory()]);
    const indexPath = join(TEST_VAULT, "index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("Fixed auth bug");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/storage/markdown.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MarkdownVault**

```typescript
// src/storage/markdown.ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Memory } from "../types";

export class MarkdownVault {
  constructor(private vaultPath: string) {
    for (const layer of ["episodic", "semantic", "procedural", "insight"]) {
      mkdirSync(join(vaultPath, layer), { recursive: true });
    }
  }

  writeMemory(mem: Memory) {
    const dir = join(this.vaultPath, mem.layer);
    mkdirSync(dir, { recursive: true });

    const frontmatter = [
      "---",
      `id: ${mem.id}`,
      `title: ${mem.title}`,
      `layer: ${mem.layer}`,
      `source: ${mem.sourceAgent}`,
      `session: ${mem.sourceSessionId}`,
      mem.project ? `project: ${mem.project}` : null,
      `created: ${mem.createdAt}`,
      `salience: ${mem.salience}`,
      "tags:",
      ...mem.tags.map((t) => `  - ${t}`),
      mem.linkedMemoryIds.length
        ? `links:\n${mem.linkedMemoryIds.map((l) => `  - "[[${l}]]"`).join("\n")}`
        : null,
      mem.contradicts.length
        ? `contradicts:\n${mem.contradicts.map((c) => `  - "[[${c}]]"`).join("\n")}`
        : null,
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    const body = [
      `# ${mem.title}`,
      "",
      "## Summary",
      "",
      mem.summary,
      "",
      "## Details",
      "",
      mem.details,
      "",
      mem.linkedMemoryIds.length
        ? `## Links\n\n${mem.linkedMemoryIds.map((l) => `- [[${l}]]`).join("\n")}`
        : null,
      mem.contradicts.length
        ? `## Contradictions\n\n${mem.contradicts.map((c) => `- ⚠️ [[${c}]]`).join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(join(dir, `${mem.id}.md`), `${frontmatter}\n\n${body}\n`);
  }

  rebuildIndex(memories: Memory[]) {
    const grouped = new Map<string, Memory[]>();
    for (const mem of memories) {
      const group = grouped.get(mem.layer) ?? [];
      group.push(mem);
      grouped.set(mem.layer, group);
    }

    const sections = [...grouped.entries()]
      .map(([layer, mems]) => {
        const items = mems
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
          .map((m) => `- [[${m.layer}/${m.id}|${m.title}]] (${m.sourceAgent}, salience: ${m.salience})`)
          .join("\n");
        return `## ${layer.charAt(0).toUpperCase() + layer.slice(1)}\n\n${items}`;
      })
      .join("\n\n");

    const content = `# Memory Vault Index\n\n> Auto-generated. Last updated: ${new Date().toISOString()}\n\n${sections}\n`;
    writeFileSync(join(this.vaultPath, "index.md"), content);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/storage/markdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/markdown.ts tests/storage/markdown.test.ts
git commit -m "feat: add Markdown vault writer"
```

---

### Task 11: LanceDB Vector Storage

**Files:**
- Create: `src/storage/vector.ts`

- [ ] **Step 1: Implement VectorStore**

```typescript
// src/storage/vector.ts
import * as lancedb from "@lancedb/lancedb";
import { config } from "../config";
import type { Memory } from "../types";

export class VectorStore {
  private db: Awaited<ReturnType<typeof lancedb.connect>> | null = null;
  private table: any = null;

  async init() {
    this.db = await lancedb.connect(config.lanceDir);
    try {
      this.table = await this.db.openTable("memories");
    } catch {
      // Table doesn't exist yet, will be created on first insert
    }
  }

  async upsert(mem: Memory, embedding: number[]) {
    const record = {
      id: mem.id,
      text: `${mem.title}\n${mem.summary}\n${mem.details}`,
      vector: embedding,
      layer: mem.layer,
      source: mem.sourceAgent,
      project: mem.project ?? "",
      salience: mem.salience,
      createdAt: mem.createdAt,
    };

    if (!this.table) {
      this.table = await this.db!.createTable("memories", [record]);
    } else {
      // Delete existing then insert (upsert pattern)
      try {
        await this.table.delete(`id = '${mem.id}'`);
      } catch {}
      await this.table.add([record]);
    }
  }

  async search(embedding: number[], limit = 10): Promise<Array<{ id: string; score: number }>> {
    if (!this.table) return [];
    const results = await this.table
      .vectorSearch(embedding)
      .limit(limit)
      .toArray();
    return results.map((r: any) => ({
      id: r.id,
      score: r._distance ?? 0,
    }));
  }

  async close() {
    // LanceDB doesn't require explicit close
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/vector.ts
git commit -m "feat: add LanceDB vector storage"
```

---

### Task 12: Storage Facade

**Files:**
- Create: `src/storage/index.ts`

- [ ] **Step 1: Create unified storage interface**

```typescript
// src/storage/index.ts
import { config } from "../config";
import { MemoryDB } from "./sqlite";
import { MarkdownVault } from "./markdown";
import { VectorStore } from "./vector";
import type { Memory, MemoryLayer } from "../types";

export class Storage {
  readonly db: MemoryDB;
  readonly vault: MarkdownVault;
  readonly vectors: VectorStore;

  constructor() {
    this.db = new MemoryDB(config.sqlitePath);
    this.vault = new MarkdownVault(config.vault);
    this.vectors = new VectorStore();
  }

  async init() {
    await this.vectors.init();
  }

  async saveMemory(mem: Memory, embedding?: number[]) {
    this.db.upsertMemory(mem);
    this.vault.writeMemory(mem);
    if (embedding) {
      await this.vectors.upsert(mem, embedding);
    }
  }

  getMemory(id: string) {
    return this.db.getMemory(id);
  }

  searchText(query: string, limit = 20) {
    return this.db.searchMemories(query, limit);
  }

  async searchSemantic(embedding: number[], limit = 10) {
    const vectorResults = await this.vectors.search(embedding, limit);
    return vectorResults
      .map((r) => {
        const mem = this.db.getMemory(r.id);
        return mem ? { ...mem, score: r.score } : null;
      })
      .filter(Boolean);
  }

  listByLayer(layer: MemoryLayer, limit = 50) {
    return this.db.listByLayer(layer, limit);
  }

  listRecent(limit = 50) {
    return this.db.listRecent(limit);
  }

  isProcessed(path: string, hash: string) {
    return this.db.isFileProcessed(path, hash);
  }

  markProcessed(path: string, hash: string, sessionId: string) {
    this.db.markFileProcessed(path, hash, sessionId);
  }

  rebuildIndex() {
    const all = this.db.listRecent(500);
    this.vault.rebuildIndex(all);
  }

  close() {
    this.db.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/index.ts
git commit -m "feat: add storage facade"
```

---

### Task 13: LLM Client & Prompts

**Files:**
- Create: `src/llm/index.ts`
- Create: `src/llm/prompts.ts`

- [ ] **Step 1: Create LLM prompt templates**

```typescript
// src/llm/prompts.ts
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
```

- [ ] **Step 2: Create LLM client**

```typescript
// src/llm/index.ts
import { generateText, embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { config } from "../config";

export async function llmGenerate(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: openai(config.llmModel),
    prompt,
    temperature: 0.3,
  });
  return text;
}

export async function llmGenerateJSON<T>(prompt: string): Promise<T> {
  const text = await llmGenerate(prompt);
  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonStr = jsonMatch[1]?.trim() ?? text.trim();
  return JSON.parse(jsonStr);
}

export async function getEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(config.embeddingModel),
    value: text,
  });
  return embedding;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/llm/index.ts src/llm/prompts.ts
git commit -m "feat: add LLM client and prompt templates"
```

---

### Task 14: Pipeline — Evaluator & Ingestor

**Files:**
- Create: `src/pipeline/evaluator.ts`
- Create: `src/pipeline/ingestor.ts`

- [ ] **Step 1: Implement Evaluator**

```typescript
// src/pipeline/evaluator.ts
import type { ParsedSession } from "../types";
import { llmGenerateJSON } from "../llm";
import { evaluatePrompt } from "../llm/prompts";

interface EvalResult {
  worth_remembering: boolean;
  reason: string;
  estimated_layers: string[];
}

export async function evaluate(session: ParsedSession): Promise<{
  shouldProcess: boolean;
  reason: string;
}> {
  // Quick heuristic: skip very short sessions
  if (session.messages.length < 2) {
    return { shouldProcess: false, reason: "Too few messages" };
  }

  // Skip sessions with only trivial content
  const totalChars = session.messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars < 100) {
    return { shouldProcess: false, reason: "Content too short" };
  }

  const result = await llmGenerateJSON<EvalResult>(evaluatePrompt(session));
  return {
    shouldProcess: result.worth_remembering,
    reason: result.reason,
  };
}
```

- [ ] **Step 2: Implement Ingestor**

```typescript
// src/pipeline/ingestor.ts
import { nanoid } from "nanoid";
import type { ParsedSession, Memory } from "../types";
import { llmGenerateJSON } from "../llm";
import { ingestPrompt } from "../llm/prompts";

interface RawMemory {
  layer: Memory["layer"];
  title: string;
  summary: string;
  details: string;
  tags: string[];
  salience: number;
}

export async function ingest(session: ParsedSession): Promise<Memory[]> {
  const rawMemories = await llmGenerateJSON<RawMemory[]>(ingestPrompt(session));

  return rawMemories.map((raw) => ({
    id: `mem-${nanoid(12)}`,
    layer: raw.layer,
    title: raw.title,
    summary: raw.summary,
    details: raw.details,
    tags: raw.tags,
    project: session.project,
    sourceSessionId: session.id,
    sourceAgent: session.source,
    createdAt: new Date().toISOString(),
    salience: Math.max(0, Math.min(1, raw.salience)),
    linkedMemoryIds: [],
    contradicts: [],
  }));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/evaluator.ts src/pipeline/ingestor.ts
git commit -m "feat: add evaluator and ingestor pipeline stages"
```

---

### Task 15: Pipeline — Linker, Consolidator, Reflector

**Files:**
- Create: `src/pipeline/linker.ts`
- Create: `src/pipeline/consolidator.ts`
- Create: `src/pipeline/reflector.ts`

- [ ] **Step 1: Implement Linker**

```typescript
// src/pipeline/linker.ts
import type { Memory } from "../types";
import { llmGenerateJSON } from "../llm";
import { linkPrompt } from "../llm/prompts";
import type { Storage } from "../storage";

interface LinkResult {
  linked_ids: string[];
  contradicts_ids: string[];
  explanation: string;
}

export async function link(memory: Memory, storage: Storage): Promise<Memory> {
  // Find potentially related memories by tags and text search
  const candidates: Memory[] = [];
  for (const tag of memory.tags) {
    const found = storage.searchText(tag, 5);
    for (const f of found) {
      if (f.id !== memory.id && !candidates.some((c) => c.id === f.id)) {
        candidates.push(f);
      }
    }
  }

  if (candidates.length === 0) return memory;

  const result = await llmGenerateJSON<LinkResult>(linkPrompt(memory, candidates.slice(0, 10)));

  return {
    ...memory,
    linkedMemoryIds: result.linked_ids.filter((id) => candidates.some((c) => c.id === id)),
    contradicts: result.contradicts_ids.filter((id) => candidates.some((c) => c.id === id)),
  };
}
```

- [ ] **Step 2: Implement Consolidator (stub)**

```typescript
// src/pipeline/consolidator.ts
import type { Memory } from "../types";
import type { Storage } from "../storage";

/**
 * Consolidation merges duplicate or overlapping memories.
 * For v1, this is a no-op — memories are kept as individual units.
 * Future: detect near-duplicate summaries and merge them.
 */
export async function consolidate(memories: Memory[], _storage: Storage): Promise<Memory[]> {
  return memories;
}
```

- [ ] **Step 3: Implement Reflector (stub)**

```typescript
// src/pipeline/reflector.ts
import type { Memory } from "../types";
import type { Storage } from "../storage";

/**
 * Reflection finds cross-session patterns and generates insight memories.
 * For v1, this is a no-op — insight generation will be added later.
 * Future: periodically scan recent memories for patterns.
 */
export async function reflect(_memories: Memory[], _storage: Storage): Promise<Memory[]> {
  return [];
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/linker.ts src/pipeline/consolidator.ts src/pipeline/reflector.ts
git commit -m "feat: add linker, consolidator, and reflector stages"
```

---

### Task 16: Pipeline Orchestrator

**Files:**
- Create: `src/pipeline/index.ts`
- Create: `tests/pipeline/pipeline.test.ts`

- [ ] **Step 1: Implement Pipeline**

```typescript
// src/pipeline/index.ts
import type { ParsedSession, PipelineResult, Memory } from "../types";
import type { Storage } from "../storage";
import { evaluate } from "./evaluator";
import { ingest } from "./ingestor";
import { link } from "./linker";
import { consolidate } from "./consolidator";
import { reflect } from "./reflector";
import { getEmbedding } from "../llm";

export async function processSession(
  session: ParsedSession,
  storage: Storage,
  log: (msg: string) => void = console.log
): Promise<PipelineResult> {
  log(`[pipeline] Evaluating session ${session.id} from ${session.source}`);

  // Stage 1: Evaluate
  const evalResult = await evaluate(session);
  if (!evalResult.shouldProcess) {
    log(`[pipeline] Skipped: ${evalResult.reason}`);
    return {
      sessionId: session.id,
      stage: "skipped",
      memories: [],
      skipped: true,
      reason: evalResult.reason,
    };
  }

  // Stage 2: Ingest
  log(`[pipeline] Ingesting...`);
  let memories = await ingest(session);
  log(`[pipeline] Extracted ${memories.length} memories`);

  // Stage 3: Link
  log(`[pipeline] Linking...`);
  const linked: Memory[] = [];
  for (const mem of memories) {
    linked.push(await link(mem, storage));
  }
  memories = linked;

  // Stage 4: Consolidate
  memories = await consolidate(memories, storage);

  // Stage 5: Save all memories
  for (const mem of memories) {
    const embedding = await getEmbedding(`${mem.title}\n${mem.summary}`);
    await storage.saveMemory(mem, embedding);
  }

  // Stage 6: Reflect (generate insights)
  const insights = await reflect(memories, storage);
  for (const insight of insights) {
    const embedding = await getEmbedding(`${insight.title}\n${insight.summary}`);
    await storage.saveMemory(insight, embedding);
    memories.push(insight);
  }

  // Rebuild vault index
  storage.rebuildIndex();

  log(`[pipeline] Done. Saved ${memories.length} memories.`);
  return {
    sessionId: session.id,
    stage: "done",
    memories,
    skipped: false,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/index.ts
git commit -m "feat: add pipeline orchestrator"
```

---

### Task 17: File Watcher

**Files:**
- Create: `src/watcher/fs-watcher.ts`
- Create: `src/watcher/state.ts`
- Create: `src/watcher/index.ts`

- [ ] **Step 1: Implement debounced fs watcher**

```typescript
// src/watcher/fs-watcher.ts
import { watch, type FSWatcher } from "fs";
import { config } from "../config";

export type FileChangeHandler = (path: string) => void;

export class DebouncedWatcher {
  private watchers: FSWatcher[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  watch(dir: string, handler: FileChangeHandler) {
    try {
      const watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const fullPath = `${dir}/${filename}`;
        // Debounce: only fire after file is stable
        const existing = this.timers.get(fullPath);
        if (existing) clearTimeout(existing);
        this.timers.set(
          fullPath,
          setTimeout(() => {
            this.timers.delete(fullPath);
            handler(fullPath);
          }, config.watchDebounceMs)
        );
      });
      this.watchers.push(watcher);
    } catch (err) {
      console.error(`[watcher] Cannot watch ${dir}:`, err);
    }
  }

  close() {
    for (const w of this.watchers) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    this.watchers = [];
    this.timers.clear();
  }
}
```

- [ ] **Step 2: Implement watcher state (dedup via content hash)**

```typescript
// src/watcher/state.ts
import { createHash } from "crypto";
import { readFileSync } from "fs";
import type { Storage } from "../storage";

export function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function shouldProcess(filePath: string, storage: Storage): boolean {
  try {
    const hash = fileHash(filePath);
    return !storage.isProcessed(filePath, hash);
  } catch {
    return false;
  }
}

export function markDone(filePath: string, sessionId: string, storage: Storage) {
  const hash = fileHash(filePath);
  storage.markProcessed(filePath, hash, sessionId);
}
```

- [ ] **Step 3: Implement watcher orchestrator**

```typescript
// src/watcher/index.ts
import { config } from "../config";
import { parsers, AmpParser } from "../parsers";
import type { Storage } from "../storage";
import { processSession } from "../pipeline";
import { DebouncedWatcher } from "./fs-watcher";
import { shouldProcess, markDone } from "./state";

export class WatcherOrchestrator {
  private watcher = new DebouncedWatcher();
  private processing = new Set<string>();

  constructor(private storage: Storage) {}

  start() {
    console.log("[watcher] Starting file watchers...");

    // Watch Codex sessions
    this.watcher.watch(config.sources.codex, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("codex", path);
    });

    // Watch Claude Code sessions
    this.watcher.watch(config.sources.claudeCode, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("claude-code", path);
    });

    // Watch Gemini sessions
    this.watcher.watch(config.sources.gemini, (path) => {
      if (path.endsWith(".json")) this.handleFile("gemini", path);
    });

    // Watch OpenCode database
    this.watcher.watch(config.sources.opencode.replace("/opencode.db", ""), (path) => {
      if (path.endsWith("opencode.db")) this.handleFile("opencode", path);
    });

    // Watch OpenClaw sessions
    this.watcher.watch(config.sources.openclaw, (path) => {
      if (path.endsWith(".jsonl")) this.handleFile("openclaw", path);
    });

    console.log("[watcher] All watchers active.");
  }

  /** Periodically poll Amp threads (no fs watch available) */
  async pollAmp() {
    const ampParser = parsers.amp as AmpParser;
    const threadIds = await ampParser.listRecentThreads();
    for (const tid of threadIds) {
      const key = `amp:${tid}`;
      if (this.storage.isProcessed(key, tid)) continue;
      const session = await ampParser.parse(tid);
      if (!session) continue;
      await processSession(session, this.storage);
      this.storage.markProcessed(key, tid, session.id);
    }
  }

  private async handleFile(parserName: string, filePath: string) {
    if (this.processing.has(filePath)) return;
    if (!shouldProcess(filePath, this.storage)) return;

    this.processing.add(filePath);
    try {
      const parser = parsers[parserName];
      if (!parser) return;

      console.log(`[watcher] New/changed: ${filePath} (${parserName})`);
      const session = await parser.parse(filePath);
      if (!session) return;

      await processSession(session, this.storage);
      markDone(filePath, session.id, this.storage);
    } catch (err) {
      console.error(`[watcher] Error processing ${filePath}:`, err);
    } finally {
      this.processing.delete(filePath);
    }
  }

  stop() {
    this.watcher.close();
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/watcher/fs-watcher.ts src/watcher/state.ts src/watcher/index.ts
git commit -m "feat: add file watcher with dedup"
```

---

### Task 18: Daemon Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create daemon entry**

```typescript
// src/index.ts
import { mkdirSync } from "fs";
import { config } from "./config";
import { Storage } from "./storage";
import { WatcherOrchestrator } from "./watcher";

async function main() {
  console.log("🧠 Memory Agent starting...");

  // Ensure data directories exist
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.vault, { recursive: true });

  // Initialize storage
  const storage = new Storage();
  await storage.init();
  console.log("✓ Storage initialized");

  // Start watcher
  const watcher = new WatcherOrchestrator(storage);
  watcher.start();
  console.log("✓ File watchers active");

  // Poll Amp threads every 5 minutes
  const ampInterval = setInterval(() => {
    watcher.pollAmp().catch((err) => console.error("[amp-poll]", err));
  }, 5 * 60 * 1000);

  // Initial Amp poll
  watcher.pollAmp().catch((err) => console.error("[amp-poll]", err));

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n🧠 Shutting down...");
    clearInterval(ampInterval);
    watcher.stop();
    storage.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("🧠 Memory Agent running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Test that daemon starts and exits cleanly**

Run: `timeout 3 bun run src/index.ts || true`
Expected: See "Memory Agent starting..." and storage/watcher init messages.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add daemon entry point"
```

---

### Task 19: TUI — Core Components

**Files:**
- Create: `src/tui/index.tsx`
- Create: `src/tui/app.tsx`
- Create: `src/tui/hooks/use-memory.ts`
- Create: `src/tui/components/timeline.tsx`
- Create: `src/tui/components/search.tsx`
- Create: `src/tui/components/detail.tsx`
- Create: `src/tui/components/status.tsx`

- [ ] **Step 1: Create data hooks**

```typescript
// src/tui/hooks/use-memory.ts
import { useState, useEffect } from "react";
import { MemoryDB } from "../../storage/sqlite";
import { config } from "../../config";
import type { Memory, MemoryLayer } from "../../types";

let db: MemoryDB | null = null;

function getDB(): MemoryDB {
  if (!db) db = new MemoryDB(config.sqlitePath);
  return db;
}

export function useRecentMemories(limit = 30) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    setMemories(getDB().listRecent(limit));
  }, [limit]);
  return memories;
}

export function useSearchMemories(query: string) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    if (query.length >= 2) {
      setMemories(getDB().searchMemories(query));
    } else {
      setMemories([]);
    }
  }, [query]);
  return memories;
}

export function useLayerMemories(layer: MemoryLayer) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    setMemories(getDB().listByLayer(layer));
  }, [layer]);
  return memories;
}

export function cleanupDB() {
  db?.close();
  db = null;
}
```

- [ ] **Step 2: Create status bar component**

```tsx
// src/tui/components/status.tsx
import React from "react";
import { Box, Text } from "ink";

interface StatusProps {
  view: string;
  memoryCount: number;
}

export function StatusBar({ view, memoryCount }: StatusProps) {
  return (
    <Box borderStyle="single" paddingX={1} justifyContent="space-between">
      <Text>🧠 Memory Agent</Text>
      <Text dimColor>View: {view}</Text>
      <Text dimColor>{memoryCount} memories</Text>
      <Text dimColor>q:quit  /:search  t:timeline  1-4:layers</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Create timeline component**

```tsx
// src/tui/components/timeline.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Memory } from "../../types";

interface TimelineProps {
  memories: Memory[];
  selectedIndex: number;
}

const LAYER_COLORS = {
  episodic: "cyan",
  semantic: "green",
  procedural: "yellow",
  insight: "magenta",
} as const;

export function Timeline({ memories, selectedIndex }: TimelineProps) {
  if (memories.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No memories yet. Start the daemon to begin collecting.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold underline>Timeline</Text>
      <Box flexDirection="column" marginTop={1}>
        {memories.slice(0, 20).map((mem, i) => (
          <Box key={mem.id}>
            <Text inverse={i === selectedIndex}>
              <Text color={LAYER_COLORS[mem.layer]}>[{mem.layer.slice(0, 4)}]</Text>
              {" "}
              <Text>{mem.title}</Text>
              {" "}
              <Text dimColor>({mem.sourceAgent}) s:{mem.salience.toFixed(1)}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Create search component**

```tsx
// src/tui/components/search.tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Memory } from "../../types";

interface SearchProps {
  query: string;
  onQueryChange: (q: string) => void;
  results: Memory[];
}

export function Search({ query, onQueryChange, results }: SearchProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text>🔍 </Text>
        <TextInput value={query} onChange={onQueryChange} placeholder="Search memories..." />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {results.map((mem) => (
          <Box key={mem.id}>
            <Text color="cyan">[{mem.layer}]</Text>
            <Text> {mem.title} </Text>
            <Text dimColor>- {mem.summary.slice(0, 60)}</Text>
          </Box>
        ))}
        {query.length >= 2 && results.length === 0 && (
          <Text dimColor>No results found.</Text>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Create detail component**

```tsx
// src/tui/components/detail.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Memory } from "../../types";

interface DetailProps {
  memory: Memory | null;
}

export function Detail({ memory }: DetailProps) {
  if (!memory) {
    return (
      <Box padding={1}>
        <Text dimColor>Select a memory to view details.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{memory.title}</Text>
      <Box marginTop={1}>
        <Text dimColor>Layer: </Text><Text color="cyan">{memory.layer}</Text>
        <Text dimColor>  Source: </Text><Text>{memory.sourceAgent}</Text>
        <Text dimColor>  Salience: </Text><Text>{memory.salience.toFixed(2)}</Text>
      </Box>
      {memory.project && (
        <Box><Text dimColor>Project: </Text><Text>{memory.project}</Text></Box>
      )}
      <Box><Text dimColor>Tags: </Text><Text>{memory.tags.join(", ")}</Text></Box>
      <Box><Text dimColor>Created: </Text><Text>{memory.createdAt}</Text></Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold underline>Summary</Text>
        <Text>{memory.summary}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold underline>Details</Text>
        <Text>{memory.details}</Text>
      </Box>
      {memory.linkedMemoryIds.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold underline>Links</Text>
          {memory.linkedMemoryIds.map((id) => (
            <Text key={id}>→ {id}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 6: Create app root**

```tsx
// src/tui/app.tsx
import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import { Timeline } from "./components/timeline";
import { Search } from "./components/search";
import { Detail } from "./components/detail";
import { StatusBar } from "./components/status";
import { useRecentMemories, useSearchMemories, cleanupDB } from "./hooks/use-memory";
import type { Memory } from "../types";

type View = "timeline" | "search" | "detail";

export function App() {
  const { exit } = useApp();
  const [view, setView] = useState<View>("timeline");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);

  const recentMemories = useRecentMemories();
  const searchResults = useSearchMemories(searchQuery);
  const displayedMemories = view === "search" ? searchResults : recentMemories;

  useInput((input, key) => {
    if (input === "q") {
      cleanupDB();
      exit();
      return;
    }
    if (input === "/" && view !== "search") {
      setView("search");
      return;
    }
    if (key.escape) {
      if (view === "detail") setView("timeline");
      else if (view === "search") { setView("timeline"); setSearchQuery(""); }
      return;
    }
    if (view !== "search") {
      if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
      if (key.downArrow) setSelectedIndex(Math.min(displayedMemories.length - 1, selectedIndex + 1));
      if (key.return && displayedMemories[selectedIndex]) {
        setSelectedMemory(displayedMemories[selectedIndex]);
        setView("detail");
      }
    }
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      <StatusBar view={view} memoryCount={recentMemories.length} />
      {view === "timeline" && (
        <Timeline memories={recentMemories} selectedIndex={selectedIndex} />
      )}
      {view === "search" && (
        <Search query={searchQuery} onQueryChange={setSearchQuery} results={searchResults} />
      )}
      {view === "detail" && <Detail memory={selectedMemory} />}
    </Box>
  );
}
```

- [ ] **Step 7: Create TUI entry point**

```tsx
// src/tui/index.tsx
import React from "react";
import { render } from "ink";
import { App } from "./app";

render(<App />);
```

- [ ] **Step 8: Add ink-text-input dependency**

Add `"ink-text-input": "^6.0.0"` to package.json dependencies, then run:

Run: `bun install`

- [ ] **Step 9: Verify TUI starts**

Run: `bun run src/tui/index.tsx`
Expected: TUI renders with status bar and empty timeline. Press q to quit.

- [ ] **Step 10: Commit**

```bash
git add src/tui/
git commit -m "feat: add Ink TUI with timeline, search, and detail views"
```

---

### Task 20: Memory Query Skill

**Files:**
- Create: `SKILL.md` (at project root, for other agents to use)

- [ ] **Step 1: Create the skill file**

```markdown
---
name: memory-query
description: Query the Memory Agent's knowledge base. Use when you need to recall past decisions, patterns, or context from previous coding sessions across all AI agents.
---

# Memory Query Skill

Query the local Memory Agent to retrieve past knowledge, decisions, and patterns.

## Usage

### Search memories by text
\`\`\`bash
cd ~/Desktop/Memory\ agent
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.searchMemories('YOUR_QUERY', 10);
console.log(JSON.stringify(results, null, 2));
db.close();
"
\`\`\`

### List recent memories
\`\`\`bash
cd ~/Desktop/Memory\ agent
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.listRecent(10);
console.log(JSON.stringify(results, null, 2));
db.close();
"
\`\`\`

### Browse by layer
\`\`\`bash
cd ~/Desktop/Memory\ agent
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.listByLayer('semantic', 10); // episodic | semantic | procedural | insight
console.log(JSON.stringify(results, null, 2));
db.close();
"
\`\`\`

### Direct vault browse
The Markdown vault is at `~/Desktop/Memory agent/vault/`. Open it with Obsidian or browse directly:
\`\`\`bash
ls ~/Desktop/Memory\ agent/vault/
cat ~/Desktop/Memory\ agent/vault/index.md
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add SKILL.md
git commit -m "feat: add memory-query skill for cross-agent access"
```

---

### Task 21: Integration Test & Smoke Test

**Files:**
- Create: `tests/pipeline/pipeline.test.ts`

- [ ] **Step 1: Write integration test (mocked LLM)**

```typescript
// tests/pipeline/pipeline.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

// We test the pipeline stages individually since full pipeline requires LLM
import { CodexParser } from "../../src/parsers/codex";

const FIXTURE = join(import.meta.dir, "../fixtures/codex-session.jsonl");

describe("Pipeline integration", () => {
  it("parses fixture and produces valid session", async () => {
    const parser = new CodexParser();
    const session = await parser.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.messages.length).toBeGreaterThanOrEqual(2);
    expect(session!.source).toBe("codex");
    // Session is ready for pipeline processing
    expect(session!.id).toBeTruthy();
    expect(session!.timestamp).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/pipeline/pipeline.test.ts
git commit -m "test: add pipeline integration test"
```

---

## Environment Setup Notes

### Required Environment Variables
- `OPENAI_API_KEY` — for Vercel AI SDK (gpt-4.1-mini and embeddings)

### Running
```bash
# Start daemon (background)
bun run start

# Open TUI
bun run tui

# Run tests
bun test
```

### Obsidian Integration
Open `~/Desktop/Memory agent/vault/` as an Obsidian vault. All memories use `[[wikilinks]]` for cross-referencing.
