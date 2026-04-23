import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeWikiLinkTarget, resolveWikiLinkTarget } from "./paths";

export interface WikiLinkRepairResult {
  scannedFiles: number;
  updatedFiles: number;
  replacements: number;
  unresolvedTargets: Array<{ target: string; count: number }>;
}

export function repairWikiLinks(
  wikiRoot: string,
  options: { write?: boolean } = {},
): WikiLinkRepairResult {
  const files = listWikiMarkdownFiles(wikiRoot);
  const existingTargets = new Set(files.map((file) => file.relativePath.slice(0, -3)));
  const unresolvedCounts = new Map<string, number>();
  let updatedFiles = 0;
  let replacements = 0;

  for (const file of files) {
    const original = readFileSync(file.absolutePath, "utf8");
    const next = original.replace(/\[\[([^\]]+)\]\]/g, (full, inner) => {
      const [targetPart, labelPart] = String(inner).split("|", 2);
      const target = targetPart.trim();

      if (!target.includes("/")) {
        return full;
      }

      const resolved = resolveWikiLinkTarget(target, existingTargets);
      if (!resolved) {
        unresolvedCounts.set(target, (unresolvedCounts.get(target) ?? 0) + 1);
        return full;
      }

      if (resolved === target) {
        return full;
      }

      replacements += 1;
      const label = labelPart === undefined ? "" : `|${labelPart}`;
      return `[[${resolved}${label}]]`;
    });

    if (next !== original) {
      updatedFiles += 1;
      if (options.write) {
        writeFileSync(file.absolutePath, next);
      }
    }
  }

  return {
    scannedFiles: files.length,
    updatedFiles,
    replacements,
    unresolvedTargets: [...unresolvedCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([target, count]) => ({ target: normalizeWikiLinkTarget(target), count })),
  };
}

function listWikiMarkdownFiles(wikiRoot: string) {
  const files: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const directory of readdirSync(wikiRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) {
      continue;
    }

    if (directory.name === "raw" || directory.name === "dashboards") {
      continue;
    }

    const absoluteDirectory = join(wikiRoot, directory.name);
    for (const fileName of readdirSync(absoluteDirectory)) {
      if (!fileName.endsWith(".md")) {
        continue;
      }

      files.push({
        absolutePath: join(absoluteDirectory, fileName),
        relativePath: `${directory.name}/${fileName}`,
      });
    }
  }

  return files;
}
