import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WikiLintTaskQueue } from "../../src/wiki/task-queue";
import type { LintIssue } from "../../src/wiki/lint";

describe("WikiLintTaskQueue", () => {
  it("writes a deduplicated task queue snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-wiki-queue-"));
    const queue = new WikiLintTaskQueue(root);

    const issues: LintIssue[] = [
      {
        page: "entities/obsidian",
        level: "error",
        message: "Broken wikilink: [[procedures/install-macos-app]]",
      },
      {
        page: "entities/context-hub",
        level: "warning",
        message: "Missing summary in frontmatter",
      },
    ];

    const first = queue.sync(issues, "session-1");
    const second = queue.sync(issues, "session-2");
    const jsonPath = join(root, "dashboards", "wiki-lint-tasks.json");
    const mdPath = join(root, "dashboards", "wiki-lint-tasks.md");

    expect(first).toEqual({
      total: 2,
      added: 2,
      resolved: 0,
      errors: 1,
      warnings: 1,
    });
    expect(second.total).toBe(2);
    expect(second.added).toBe(0);
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const tasks = JSON.parse(readFileSync(jsonPath, "utf8")) as Array<{
      target?: string;
      occurrences: number;
      sources: string[];
    }>;
    expect(tasks[0]?.occurrences).toBe(2);
    expect(tasks[0]?.sources).toEqual(["session-1", "session-2"]);
    expect(tasks[0]?.target).toBe("procedures/install-macos-app");

    rmSync(root, { recursive: true, force: true });
  });

  it("removes resolved issues from the queue snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-wiki-queue-"));
    const queue = new WikiLintTaskQueue(root);

    queue.sync([
      {
        page: "entities/obsidian",
        level: "error",
        message: "Broken wikilink: [[procedures/install-macos-app]]",
      },
    ], "session-1");

    const result = queue.sync([], "session-2");
    const tasks = JSON.parse(readFileSync(join(root, "dashboards", "wiki-lint-tasks.json"), "utf8")) as unknown[];

    expect(result).toEqual({
      total: 0,
      added: 0,
      resolved: 1,
      errors: 0,
      warnings: 0,
    });
    expect(tasks).toEqual([]);

    rmSync(root, { recursive: true, force: true });
  });
});
