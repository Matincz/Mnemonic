// src/wiki/query.ts
import { llmGenerate, llmGenerateJSON } from "../llm";
import { wikiAnswerPrompt, wikiSelectPagesPrompt } from "../llm/prompts";
import { WikiSelectionSchema } from "../llm/schemas";
import type { WikiEngine } from "./engine";
import type { IndexManager } from "./index-manager";
import { getWikiTypeFromDirectory } from "./paths";
import type { WikiPage } from "./types";

export interface WikiQuerySource {
  path: string;
  title: string;
  summary: string;
  updatedAt: string;
  filePath: string;
}

export interface WikiQueryResult {
  answer: string;
  sources: WikiQuerySource[];
}

export class WikiQuery {
  constructor(
    private engine: WikiEngine,
    private indexManager: IndexManager,
  ) {}

  async query(question: string): Promise<WikiQueryResult> {
    const indexContent = this.indexManager.getIndex();
    const { pages } = await llmGenerateJSON(wikiSelectPagesPrompt(indexContent, question), WikiSelectionSchema);

    const pageContents: Array<{ path: string; content: string }> = [];
    const sourcePages: WikiPage[] = [];
    for (const pagePath of pages) {
      const [dir, slug] = pagePath.split("/");
      const type = getWikiTypeFromDirectory(dir);
      if (!type || !slug) {
        continue;
      }

      const page = this.engine.getPage(type, slug);
      if (page) {
        pageContents.push({ path: pagePath, content: page.content });
        sourcePages.push(page);
      }
    }

    if (pageContents.length === 0) {
      return {
        answer: "No relevant wiki pages found.",
        sources: [],
      };
    }

    const answer = await llmGenerate(wikiAnswerPrompt(question, pageContents));
    return {
      answer,
      sources: sourcePages.map((page) => ({
        path: `${dirForType(page.type)}/${page.slug}`,
        title: page.title,
        summary: page.summary,
        updatedAt: page.updatedAt,
        filePath: this.engine.getPagePath(page.type, page.slug),
      })),
    };
  }
}

function dirForType(type: WikiPage["type"]) {
  switch (type) {
    case "entity":
      return "entities";
    case "concept":
      return "concepts";
    case "source":
      return "sources";
    case "procedure":
      return "procedures";
    case "insight":
      return "insights";
  }
}
