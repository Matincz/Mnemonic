import { homedir } from "os";
import { join } from "path";
import { getAppPaths } from "./app-paths";

const appPaths = getAppPaths();
const HOME = homedir();

export const config = {
  appName: "Mnemonic",
  sources: {
    codex: join(HOME, ".codex/sessions"),
    claudeCode: join(HOME, ".claude/projects"),
    gemini: join(HOME, ".gemini/tmp"),
    opencode: join(HOME, ".local/share/opencode/opencode.db"),
    openclaw: join(HOME, ".openclaw/agents"),
    amp: "amp-cli",
  },
  dataRoot: appPaths.dataRoot,
  configRoot: appPaths.configRoot,
  vault: appPaths.vaultPath,
  dataDir: appPaths.dataDir,
  sqlitePath: appPaths.sqlitePath,
  lanceDir: appPaths.lanceDir,
  settingsPath: appPaths.settingsPath,
  watchDebounceMs: 2000,
  maxSessionAgeDays: 7,
  llmModel: process.env.LLM_MODEL ?? "gpt-4.1-mini",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
} as const;
