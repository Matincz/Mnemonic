// src/wiki/index-manager.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { WikiEngine } from "./engine";
import { getWikiPath } from "./paths";
import type { WikiPageType } from "./types";

const typeLabels: Record<WikiPageType, string> = {
  entity: "Entities",
  concept: "Concepts",
  source: "Sources",
  procedure: "Procedures",
  insight: "Insights",
};

const typeOrder: WikiPageType[] = ["entity", "concept", "source", "procedure", "insight"];

export class IndexManager {
  constructor(
    private wikiRoot: string,
    private engine: WikiEngine,
  ) {}

  rebuild() {
    const sections: string[] = [];

    for (const type of typeOrder) {
      const pages = this.engine.listPages(type);
      if (pages.length === 0) continue;

      const items = pages
        .map((p) => {
          const summary = p.summary ? ` — ${p.summary}` : "";
          return `- [[${getWikiPath(type, p.slug)}|${p.title}]]${summary}`;
        })
        .join("\n");

      sections.push(`## ${typeLabels[type]}\n\n${items}`);
    }

    const content = [
      "# Wiki Index",
      "",
      `> Auto-generated. Last updated: ${new Date().toISOString()}`,
      "",
      sections.join("\n\n"),
      "",
    ].join("\n");

    writeFileSync(join(this.wikiRoot, "index.md"), content);
  }

  getIndex() {
    const indexPath = join(this.wikiRoot, "index.md");
    if (!existsSync(indexPath)) {
      return "";
    }
    return readFileSync(indexPath, "utf8");
  }

  appendEntry(type: WikiPageType, slug: string, title: string, summary: string) {
    const indexPath = join(this.wikiRoot, "index.md");
    const heading = `## ${typeLabels[type]}`;
    const entry = summary
      ? `- [[${getWikiPath(type, slug)}|${title}]] — ${summary}`
      : `- [[${getWikiPath(type, slug)}|${title}]]`;

    if (!existsSync(indexPath)) {
      const content = `# Wiki Index\n\n> Auto-generated. Last updated: ${new Date().toISOString()}\n\n${heading}\n\n${entry}\n`;
      writeFileSync(indexPath, content);
      return;
    }

    const existing = readFileSync(indexPath, "utf8");

    if (existing.includes(heading)) {
      const updated = existing.replace(heading, `${heading}\n\n${entry}`);
      writeFileSync(indexPath, updated);
    } else {
      writeFileSync(indexPath, `${existing}\n${heading}\n\n${entry}\n`);
    }
  }
}
