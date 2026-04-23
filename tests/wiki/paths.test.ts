import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ParsedSession } from "../../src/types";
import { IndexManager } from "../../src/wiki/index-manager";
import { WikiLint } from "../../src/wiki/lint";
import { WikiEngine } from "../../src/wiki/engine";
import { repairWikiLinks } from "../../src/wiki/repair";
import { collectExistingPageSummaries } from "../../src/wiki/summaries";

const wikiRoot = join(tmpdir(), `mnemonic-wiki-${Date.now()}`);

describe("wiki paths", () => {
  it("treats entities wikilinks as valid", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "entity",
      "memory-agent",
      `---
title: Memory Agent
summary: Test entity
---

# Memory Agent
`,
    );
    engine.writePage(
      "concept",
      "progressive-disclosure",
      `---
title: Progressive Disclosure
summary: Test concept
wikilinks:
  - [[entities/memory-agent]]
---

# Progressive Disclosure
`,
    );

    const lint = new WikiLint(engine);
    expect(lint.check()).toEqual([]);
  });

  it("accepts singular wiki directory aliases when the plural page exists", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "concept",
      "auth-flow",
      `---
title: Auth Flow
summary: Durable auth design
---

# Auth Flow
`,
    );
    engine.writePage(
      "entity",
      "memory-agent",
      `---
title: Memory Agent
summary: Entity page
---

# Memory Agent

See [[concept/auth-flow]].
`,
    );

    const lint = new WikiLint(engine);
    expect(lint.check()).toEqual([]);
  });

  it("ignores shell-style [[...]] syntax inside fenced code blocks", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "concept",
      "shell-snippet",
      `---
title: Shell Snippet
summary: Contains shell conditionals
---

# Shell Snippet

\`\`\`bash
if [[ -d "$HOME/.codex" ]]; then
  echo ok
fi
\`\`\`
`,
    );

    const lint = new WikiLint(engine);
    expect(lint.check()).toEqual([]);
  });

  it("writes entities paths into the index", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "entity",
      "memory-agent",
      `---
title: Memory Agent
summary: Test entity
---

# Memory Agent
`,
    );

    const index = new IndexManager(wikiRoot, engine);
    index.rebuild();

    const content = index.getIndex();
    expect(content).toContain("[[entities/memory-agent|Memory Agent]]");
    expect(content).not.toContain("[[entitys/memory-agent|Memory Agent]]");
  });

  it("collects existing page summaries for merge-aware wiki updates", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "concept",
      "auth-flow",
      `---
title: Auth Flow
summary: Existing auth design
---

# Auth Flow

The current auth flow rotates refresh tokens after each successful exchange.
`,
    );

    const summaries = collectExistingPageSummaries(engine);
    expect(summaries).toContain("[concepts/auth-flow] Auth Flow");
    expect(summaries).toContain("summary: Existing auth design");
    expect(summaries).toContain("rotates refresh tokens");
  });

  it("prefers pages relevant to the current session when the wiki is large", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);

    for (let index = 0; index < 21; index += 1) {
      engine.writePage(
        "concept",
        `generic-page-${index}`,
        `---
title: Generic Page ${index}
summary: Unrelated page ${index}
updatedAt: 2026-04-17T00:00:${String(index).padStart(2, "0")}.000Z
---

# Generic Page ${index}

Unrelated content ${index}.
`,
      );
    }

    engine.writePage(
      "concept",
      "auth-refresh-rotation",
      `---
title: Auth Refresh Rotation
summary: Relevant auth design
tags:
  - payments
  - auth
updatedAt: 2026-04-16T23:59:00.000Z
---

# Auth Refresh Rotation

Refresh tokens rotate after each successful exchange.
`,
    );

    const session: ParsedSession = {
      id: "session-auth",
      source: "codex",
      timestamp: new Date("2026-04-17T00:00:00.000Z"),
      project: "payments",
      rawPath: "/tmp/session-auth.md",
      messages: [
        {
          role: "user",
          content: "Please update the payments auth refresh flow and token rotation docs.",
        },
      ],
    };

    const summaries = collectExistingPageSummaries(engine, session);
    expect(summaries).toContain("[concepts/auth-refresh-rotation] Auth Refresh Rotation");
  });

  it("repairs safe wiki directory aliases in place", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "concept",
      "auth-flow",
      `---
title: Auth Flow
summary: Existing auth design
---

# Auth Flow
`,
    );

    const entityPath = join(wikiRoot, "entities", "memory-agent.md");
    writeFileSync(
      entityPath,
      `---
title: Memory Agent
summary: Test entity
---

# Memory Agent

Links: [[concept/auth-flow]]
`,
    );

    const dryRun = repairWikiLinks(wikiRoot);
    expect(dryRun.updatedFiles).toBe(1);
    expect(dryRun.replacements).toBe(1);

    const written = repairWikiLinks(wikiRoot, { write: true });
    expect(written.updatedFiles).toBe(1);
    expect(readFileSync(entityPath, "utf8")).toContain("[[concepts/auth-flow]]");
  });

  it("repairs links by unique slug fallback when the directory is wrong", () => {
    mkdirSync(wikiRoot, { recursive: true });

    const engine = new WikiEngine(wikiRoot);
    engine.writePage(
      "procedure",
      "deploy-flow",
      `---
title: Deploy Flow
summary: Existing procedure
---

# Deploy Flow
`,
    );

    const entityPath = join(wikiRoot, "entities", "deployment-bot.md");
    writeFileSync(
      entityPath,
      `---
title: Deployment Bot
summary: Test entity
---

# Deployment Bot

Links: [[procedural/deploy-flow]]
`,
    );

    const written = repairWikiLinks(wikiRoot, { write: true });
    expect(written.replacements).toBe(1);
    expect(readFileSync(entityPath, "utf8")).toContain("[[procedures/deploy-flow]]");
  });
});

if (existsSync(wikiRoot)) {
  rmSync(wikiRoot, { recursive: true, force: true });
}
