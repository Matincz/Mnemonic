import type { ParsedSession } from "../types";
import type { WikiEngine } from "./engine";
import { getWikiPath } from "./paths";

export function collectExistingPageSummaries(engine: WikiEngine, session?: ParsedSession): string {
  const allPages = engine.listPages();
  let pages: ReturnType<WikiEngine["listPages"]>;

  if (session && allPages.length > 20) {
    const sessionText = session.messages.map((message) => message.content).join(" ").toLowerCase();
    const scored = allPages.map((page) => ({
      page,
      score: scorePageRelevance(page, session.project, sessionText),
    }));
    scored.sort((left, right) => right.score - left.score);
    pages = scored.slice(0, 20).map((entry) => entry.page);
  } else {
    pages = allPages.slice(0, 20);
  }

  const sections: string[] = [];
  let total = 0;

  for (const page of pages) {
    const excerpt = page.content.replace(/\s+/g, " ").trim().slice(0, 500) || "(empty)";
    const block = [
      `[${getWikiPath(page.type, page.slug)}] ${page.title}`,
      `summary: ${page.summary || "(none)"}`,
      `excerpt: ${excerpt}`,
    ].join("\n");

    if (sections.length > 0 && total + block.length > 5000) {
      break;
    }

    sections.push(block);
    total += block.length;
  }

  return sections.join("\n\n---\n\n");
}

function scorePageRelevance(
  page: { title: string; tags: string[]; summary: string },
  project: string | undefined,
  sessionText: string,
): number {
  let score = 0;

  if (project && page.tags.some((tag) => tag.toLowerCase() === project.toLowerCase())) {
    score += 3;
  }

  const titleTokens = page.title.toLowerCase().split(/\s+/);
  for (const token of titleTokens) {
    if (token.length > 3 && sessionText.includes(token)) {
      score += 1;
    }
  }

  for (const tag of page.tags) {
    if (sessionText.includes(tag.toLowerCase())) {
      score += 0.5;
    }
  }

  return score;
}
