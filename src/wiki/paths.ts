import type { WikiPageType } from "./types";

export const wikiDirectories: Record<WikiPageType, string> = {
  entity: "entities",
  concept: "concepts",
  source: "sources",
  procedure: "procedures",
  insight: "insights",
};

const directoryToType = Object.fromEntries(
  Object.entries(wikiDirectories).map(([type, directory]) => [directory, type as WikiPageType]),
) as Record<string, WikiPageType>;

const wikiDirectoryAliases = new Map<string, string>([
  ["entity", "entities"],
  ["entities", "entities"],
  ["concept", "concepts"],
  ["concepts", "concepts"],
  ["source", "sources"],
  ["sources", "sources"],
  ["procedure", "procedures"],
  ["procedures", "procedures"],
  ["insight", "insights"],
  ["insights", "insights"],
]);

export function getWikiDirectory(type: WikiPageType) {
  return wikiDirectories[type];
}

export function getWikiPath(type: WikiPageType, slug: string) {
  return `${getWikiDirectory(type)}/${slug}`;
}

export function getWikiTypeFromDirectory(directory: string) {
  return directoryToType[directory];
}

export function normalizeWikiLinkTarget(target: string) {
  const [directory, ...rest] = target.split("/");
  if (!directory || rest.length === 0) {
    return target;
  }

  const normalizedDirectory = wikiDirectoryAliases.get(directory) ?? directory;
  return `${normalizedDirectory}/${rest.join("/")}`;
}

export function resolveWikiLinkTarget(target: string, existingTargets: Set<string>) {
  if (!target.includes("/")) {
    return null;
  }

  if (existingTargets.has(target)) {
    return target;
  }

  const normalized = normalizeWikiLinkTarget(target);
  if (existingTargets.has(normalized)) {
    return normalized;
  }

  const slug = target.split("/", 2)[1];
  if (slug) {
    const matches = [...existingTargets].filter((candidate) => candidate.endsWith(`/${slug}`));
    if (matches.length === 1) {
      return matches[0]!;
    }
  }

  return null;
}
