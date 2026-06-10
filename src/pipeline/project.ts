const PROJECT_ALIASES: Record<string, string> = {
  "workspace-iot": "iot",
  "workspace-code": "code",
  "workspace-rube": "rube",
  workspace: "general",
  matincz: "general",
};

export function normalizeProjectName(project?: string): string | undefined {
  const trimmed = project?.trim();
  if (!trimmed) {
    return undefined;
  }

  const fromPath = trimmed.includes("/") ? extractProjectNameFromPath(trimmed) : undefined;
  const normalized = fromPath ?? trimmed;
  return PROJECT_ALIASES[normalized.toLowerCase()] ?? normalized;
}

export function inferProjectFromText(text: string): string {
  const normalizedCwd = extractProjectFromCwd(text);
  if (normalizedCwd) {
    return normalizedCwd;
  }

  const normalizedPath = extractProjectFromPath(text);
  if (normalizedPath) {
    return normalizedPath;
  }

  const repo = text.match(/\b(?:repo|repository|git(?:\s+repository)?)[:=]\s*([A-Za-z0-9._-]+)/i)?.[1];
  return normalizeProjectName(repo) ?? "general";
}

function extractProjectFromCwd(text: string) {
  const match = text.match(/\b(?:cwd|pwd|git\s+root|repo\s+root|repository\s+root)\s*[:=]\s*([^\s"'`<>]+)/i)?.[1];
  return match ? extractProjectNameFromPath(match) : undefined;
}

function extractProjectFromPath(text: string) {
  const match = text.match(/\/(?:Users|Volumes|private\/tmp|tmp)\/[^\s"'`<>]+/i)?.[0];
  return match ? extractProjectNameFromPath(match) : undefined;
}

function extractProjectNameFromPath(path: string) {
  const parts = path.split("/").filter(Boolean).filter((part) => part !== ".git");
  const containers = new Set(["Desktop", "Documents", "Projects", "Code", "Repos", "Codex"]);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (containers.has(parts[index]!) && parts[index + 1]) {
      const project = pickRepositorySegment(parts.slice(index + 1));
      return project ? normalizeProjectName(project) : undefined;
    }
  }

  const last = parts.at(-1);
  if (!last || last.includes(".")) {
    return undefined;
  }
  return normalizeProjectName(last);
}

function pickRepositorySegment(parts: string[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    if (part.includes(".")) {
      continue;
    }
    if (isDateSegment(part) || isCommonSubdirectory(part)) {
      continue;
    }
    return part;
  }

  return parts.find((part) => !part.includes("."));
}

function isDateSegment(part: string) {
  return /^\d{4}(?:-\d{2}){0,2}$/.test(part);
}

function isCommonSubdirectory(part: string) {
  return new Set(["src", "lib", "tests", "test", "docs", "bin", "dist", "build", "node_modules"]).has(part);
}
