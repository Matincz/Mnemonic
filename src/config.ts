import { homedir } from "os";
import { join } from "path";
import { resolveAppPaths, type AppPaths } from "./app-paths";

export interface Config {
  appName: "Mnemonic";
  sources: {
    codex: string;
    claudeCode: string;
    gemini: string;
    opencode: string;
    openclaw: string;
    amp: string;
  };
  dataRoot: string;
  configRoot: string;
  vault: string;
  dataDir: string;
  sqlitePath: string;
  lanceDir: string;
  settingsPath: string;
  ipcDir: string;
  ipcStatusPath: string;
  ipcEventsPath: string;
  watchDebounceMs: number;
  maxSessionAgeDays: number;
  vectorBackend: "sqlite" | "lancedb";
  llmModel: string;
  openaiApiKey: string;
  openaiBaseURL: string;
}

export interface LoadConfigInput {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  appPaths?: AppPaths;
  overrides?: Partial<Config>;
}

export function loadConfig(input: LoadConfigInput = {}): Config {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? homedir();
  const appPaths = input.appPaths ?? resolveAppPaths({ homeDir, env });

  const base: Config = {
    appName: "Mnemonic",
    sources: {
      codex: join(homeDir, ".codex/sessions"),
      claudeCode: join(homeDir, ".claude/projects"),
      gemini: join(homeDir, ".gemini/tmp"),
      opencode: join(homeDir, ".local/share/opencode/opencode.db"),
      openclaw: join(homeDir, ".openclaw/agents"),
      amp: "amp-cli",
    },
    dataRoot: appPaths.dataRoot,
    configRoot: appPaths.configRoot,
    vault: appPaths.vaultPath,
    dataDir: appPaths.dataDir,
    sqlitePath: appPaths.sqlitePath,
    lanceDir: env.MNEMONIC_LANCE_DIR ?? appPaths.lanceDir,
    settingsPath: appPaths.settingsPath,
    ipcDir: appPaths.ipcDir,
    ipcStatusPath: appPaths.ipcStatusPath,
    ipcEventsPath: appPaths.ipcEventsPath,
    watchDebounceMs: 2000,
    maxSessionAgeDays: 7,
    vectorBackend: env.MNEMONIC_VECTOR_BACKEND === "sqlite" ? "sqlite" : "lancedb",
    llmModel: env.LLM_MODEL ?? "gpt-4.1-mini",
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    openaiBaseURL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  };

  if (!input.overrides) {
    return base;
  }

  return {
    ...base,
    ...input.overrides,
    sources: {
      ...base.sources,
      ...(input.overrides.sources ?? {}),
    },
  };
}

export const config = loadConfig();
