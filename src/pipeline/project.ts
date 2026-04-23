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
