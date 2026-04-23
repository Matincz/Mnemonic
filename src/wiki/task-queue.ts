import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { LintIssue } from "./lint";

export interface WikiLintTask {
  id: string;
  page: string;
  level: "error" | "warning";
  kind: "broken-wikilink" | "missing-title" | "missing-summary" | "empty-page" | "other";
  message: string;
  target?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  sources: string[];
}

export interface WikiLintQueueSyncResult {
  total: number;
  added: number;
  resolved: number;
  errors: number;
  warnings: number;
}

export class WikiLintTaskQueue {
  constructor(private wikiRoot: string) {
    mkdirSync(join(wikiRoot, "dashboards"), { recursive: true });
  }

  sync(issues: LintIssue[], source?: string): WikiLintQueueSyncResult {
    const now = new Date().toISOString();
    const existing = this.read();
    const existingMap = new Map(existing.map((task) => [task.id, task]));
    const next = issues.map((issue) => {
      const id = createTaskId(issue);
      const previous = existingMap.get(id);
      const classification = classifyIssue(issue);

      return {
        id,
        page: issue.page,
        level: issue.level,
        kind: classification.kind,
        message: issue.message,
        ...(classification.target ? { target: classification.target } : {}),
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastSeenAt: now,
        occurrences: (previous?.occurrences ?? 0) + 1,
        sources: source
          ? Array.from(new Set([...(previous?.sources ?? []), source]))
          : (previous?.sources ?? []),
      } satisfies WikiLintTask;
    });

    next.sort((left, right) =>
      severityRank(left.level) - severityRank(right.level) ||
      left.page.localeCompare(right.page) ||
      left.message.localeCompare(right.message)
    );

    this.write(next);

    const nextIds = new Set(next.map((task) => task.id));
    return {
      total: next.length,
      added: next.filter((task) => !existingMap.has(task.id)).length,
      resolved: existing.filter((task) => !nextIds.has(task.id)).length,
      errors: next.filter((task) => task.level === "error").length,
      warnings: next.filter((task) => task.level === "warning").length,
    };
  }

  private read(): WikiLintTask[] {
    const filePath = this.getJsonPath();
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as WikiLintTask[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(tasks: WikiLintTask[]) {
    writeFileSync(this.getJsonPath(), `${JSON.stringify(tasks, null, 2)}\n`);
    writeFileSync(this.getMarkdownPath(), renderMarkdown(tasks));
  }

  private getJsonPath() {
    return join(this.wikiRoot, "dashboards", "wiki-lint-tasks.json");
  }

  private getMarkdownPath() {
    return join(this.wikiRoot, "dashboards", "wiki-lint-tasks.md");
  }
}

function createTaskId(issue: LintIssue) {
  return `${issue.page}::${issue.message}`;
}

function classifyIssue(issue: LintIssue) {
  const broken = issue.message.match(/^Broken wikilink: \[\[([^\]]+)\]\]$/);
  if (broken?.[1]) {
    return {
      kind: "broken-wikilink" as const,
      target: broken[1],
    };
  }

  if (issue.message === "Missing or default title") {
    return { kind: "missing-title" as const };
  }

  if (issue.message === "Missing summary in frontmatter") {
    return { kind: "missing-summary" as const };
  }

  if (issue.message === "Empty page content") {
    return { kind: "empty-page" as const };
  }

  return { kind: "other" as const };
}

function renderMarkdown(tasks: WikiLintTask[]) {
  const errors = tasks.filter((task) => task.level === "error");
  const warnings = tasks.filter((task) => task.level === "warning");

  return [
    "# Wiki Lint Task Queue",
    "",
    `> Updated: ${new Date().toISOString()}`,
    `> Open tasks: ${tasks.length} (${errors.length} errors, ${warnings.length} warnings)`,
    "",
    tasks.length === 0
      ? "_No open wiki lint tasks._"
      : tasks.map((task) =>
          [
            `## [${task.level}] ${task.page}`,
            "",
            `- kind: ${task.kind}`,
            `- message: ${task.message}`,
            task.target ? `- target: ${task.target}` : null,
            `- firstSeenAt: ${task.firstSeenAt}`,
            `- lastSeenAt: ${task.lastSeenAt}`,
            `- occurrences: ${task.occurrences}`,
            task.sources.length > 0 ? `- sources: ${task.sources.join(", ")}` : null,
            "",
          ]
            .filter(Boolean)
            .join("\n")
        ).join("\n"),
    "",
  ].join("\n");
}

function severityRank(level: WikiLintTask["level"]) {
  return level === "error" ? 0 : 1;
}
