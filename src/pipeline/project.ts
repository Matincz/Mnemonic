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

  return PROJECT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
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
  const match = text.match(/\b(?:cwd|pwd)\s*[:=]\s*([^\s"'`<>]+)/i)?.[1];
  return match ? extractProjectNameFromPath(match) : undefined;
}

function extractProjectFromPath(text: string) {
  const match = text.match(/\/Users\/[^\s"'`<>]+/i)?.[0];
  return match ? extractProjectNameFromPath(match) : undefined;
}

function extractProjectNameFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const containers = new Set(["Desktop", "Documents", "Projects", "Code", "Repos"]);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (containers.has(parts[index]!) && parts[index + 1]) {
      return normalizeProjectName(parts[index + 1]);
    }
  }

  const last = parts.at(-1);
  if (!last || last.includes(".")) {
    return undefined;
  }
  return normalizeProjectName(last);
}
