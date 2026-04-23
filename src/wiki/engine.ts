// src/wiki/engine.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureSchema } from "./schema";
import { resolveWikiLinkTarget, wikiDirectories } from "./paths";
import type { WikiPage, WikiPageType } from "./types";

type FrontmatterValue = string | string[];
type Frontmatter = Record<string, FrontmatterValue | undefined>;

export class WikiEngine {
  constructor(private wikiRoot: string) {
    mkdirSync(wikiRoot, { recursive: true });

    for (const directory of Object.values(wikiDirectories)) {
      mkdirSync(join(wikiRoot, directory), { recursive: true });
    }

    mkdirSync(join(wikiRoot, "raw"), { recursive: true });
    ensureSchema(wikiRoot);
  }

  getRootPath() {
    return this.wikiRoot;
  }

  readPage(type: WikiPageType, slug: string) {
    const filePath = this.getPagePath(type, slug);
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, "utf8");
    return splitFrontmatter(raw).content;
  }

  getPage(type: WikiPageType, slug: string) {
    const filePath = this.getPagePath(type, slug);
    if (!existsSync(filePath)) {
      return null;
    }

    return parsePageFile(type, slug, filePath);
  }

  writePage(type: WikiPageType, slug: string, content: string) {
    const filePath = this.getPagePath(type, slug);
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`);
  }

  listPages(type?: WikiPageType) {
    const types = type ? [type] : (Object.keys(wikiDirectories) as WikiPageType[]);
    const pages: WikiPage[] = [];

    for (const pageType of types) {
      const directory = join(this.wikiRoot, wikiDirectories[pageType]);
      for (const fileName of readdirSync(directory)) {
        if (!fileName.endsWith(".md")) {
          continue;
        }

        const slug = fileName.slice(0, -3);
        const filePath = join(directory, fileName);
        pages.push(parsePageFile(pageType, slug, filePath));
      }
    }

    return pages.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  pageExists(type: WikiPageType, slug: string) {
    return existsSync(this.getPagePath(type, slug));
  }

  listLinkTargets() {
    const targets = new Set<string>();

    for (const directory of readdirSync(this.wikiRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) {
        continue;
      }

      if (directory.name === "raw" || directory.name === "dashboards") {
        continue;
      }

      const absoluteDirectory = join(this.wikiRoot, directory.name);
      for (const fileName of readdirSync(absoluteDirectory)) {
        if (!fileName.endsWith(".md")) {
          continue;
        }

        targets.add(`${directory.name}/${fileName.slice(0, -3)}`);
      }
    }

    return targets;
  }

  resolveLinkTarget(target: string) {
    return resolveWikiLinkTarget(target, this.listLinkTargets());
  }

  getPagePath(type: WikiPageType, slug: string) {
    return join(this.wikiRoot, wikiDirectories[type], `${slug}.md`);
  }

  saveRawSession(sessionId: string, content: string) {
    const filePath = join(this.wikiRoot, "raw", `${sessionId}.md`);
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`);
  }
}

function parsePageFile(type: WikiPageType, slug: string, filePath: string): WikiPage {
  const raw = readFileSync(filePath, "utf8");
  const stats = statSync(filePath);
  const { frontmatter, content } = splitFrontmatter(raw);
  const wikilinks = readArray(frontmatter.wikilinks);

  return {
    slug,
    type,
    title: readString(frontmatter.title) || extractTitle(content, slug),
    summary: readString(frontmatter.summary),
    content,
    tags: readArray(frontmatter.tags),
    wikilinks: wikilinks.length ? wikilinks : extractWikilinks(content),
    createdAt: readString(frontmatter.createdAt) || stats.birthtime.toISOString(),
    updatedAt: readString(frontmatter.updatedAt) || stats.mtime.toISOString(),
  };
}

function splitFrontmatter(raw: string) {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {} as Frontmatter, content: normalized };
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { frontmatter: {} as Frontmatter, content: normalized };
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const content = normalized.slice(closingIndex + 5).replace(/^\n/, "");
  return {
    frontmatter: parseFrontmatter(frontmatterBlock),
    content,
  };
}

function parseFrontmatter(block: string): Frontmatter {
  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;

  for (const line of block.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("  - ") && currentKey) {
      const currentValue = frontmatter[currentKey];
      const item = stripQuotes(line.slice(4).trim());
      if (Array.isArray(currentValue)) {
        currentValue.push(item);
      } else {
        frontmatter[currentKey] = [item];
      }
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      currentKey = null;
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!value) {
      frontmatter[key] = [];
      currentKey = key;
      continue;
    }

    frontmatter[key] = stripQuotes(value);
    currentKey = null;
  }

  return frontmatter;
}

function readString(value: FrontmatterValue | undefined) {
  return typeof value === "string" ? value : "";
}

function readArray(value: FrontmatterValue | undefined) {
  return Array.isArray(value) ? value : [];
}

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function extractTitle(content: string, slug: string) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || slug;
}

function extractWikilinks(content: string) {
  const withoutFencedCode = content.replace(/```[\s\S]*?```/g, "");
  const withoutInlineCode = withoutFencedCode.replace(/`[^`\n]+`/g, "");
  return [...withoutInlineCode.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);
}
