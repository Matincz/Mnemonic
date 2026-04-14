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
