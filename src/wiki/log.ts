// src/wiki/log.ts
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

interface WikiLogEntry {
  action: string;
  pages: string[];
  source?: string;
  timestamp?: string;
}

export class WikiLog {
  constructor(private wikiRoot: string) {
    mkdirSync(wikiRoot, { recursive: true });
  }

  append(entry: WikiLogEntry) {
    const filePath = join(this.wikiRoot, "log.md");
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const lines = [
      `## ${timestamp}`,
      "",
      `- Action: ${entry.action}`,
      "- Pages:",
      ...entry.pages.map((page) => `  - ${page}`),
      entry.source ? `- Source: ${entry.source}` : null,
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const content = existsSync(filePath)
      ? `${lines}\n`
      : `# Wiki Operation Log\n\n${lines}\n`;

    appendFileSync(filePath, content);
  }
}
