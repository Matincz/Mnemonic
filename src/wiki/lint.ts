// src/wiki/lint.ts
import type { WikiEngine } from "./engine";
import { getWikiPath } from "./paths";

export interface LintIssue {
  page: string;
  level: "error" | "warning";
  message: string;
}

export class WikiLint {
  constructor(private engine: WikiEngine) {}

  check(): LintIssue[] {
    const issues: LintIssue[] = [];
    const pages = this.engine.listPages();

    for (const page of pages) {
      const pagePath = getWikiPath(page.type, page.slug);

      if (!page.title || page.title === page.slug) {
        issues.push({ page: pagePath, level: "warning", message: "Missing or default title" });
      }

      if (!page.summary) {
        issues.push({ page: pagePath, level: "warning", message: "Missing summary in frontmatter" });
      }

      for (const link of page.wikilinks) {
        const target = link.replace(/\[\[|\]\]/g, "").split("|")[0].trim();
        if (target.includes("/") && !this.engine.resolveLinkTarget(target)) {
          issues.push({ page: pagePath, level: "error", message: `Broken wikilink: [[${target}]]` });
        }
      }

      if (!page.content.trim()) {
        issues.push({ page: pagePath, level: "error", message: "Empty page content" });
      }
    }

    return issues;
  }

  report(limit = Infinity): string {
    const issues = this.check();
    if (issues.length === 0) return "✓ Wiki is healthy. No issues found.";

    const errors = issues.filter((i) => i.level === "error");
    const warnings = issues.filter((i) => i.level === "warning");
    const shownIssues = Number.isFinite(limit) ? issues.slice(0, limit) : issues;
    const lines = [
      `Wiki Lint: ${errors.length} error(s), ${warnings.length} warning(s)`,
      "",
      ...shownIssues.map((i) => `[${i.level}] ${i.page}: ${i.message}`),
    ];
    if (shownIssues.length < issues.length) {
      lines.push("", `... truncated ${issues.length - shownIssues.length} additional issue(s)`);
    }
    return lines.join("\n");
  }
}
