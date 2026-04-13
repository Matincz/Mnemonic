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
