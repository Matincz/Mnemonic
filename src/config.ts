import { homedir } from "os";
import { join } from "path";

const HOME = homedir();

export const config = {
  sources: {
    codex: join(HOME, ".codex/sessions"),
    claudeCode: join(HOME, ".claude/projects"),
    gemini: join(HOME, ".gemini/tmp"),
    opencode: join(HOME, ".local/share/opencode/opencode.db"),
    openclaw: join(HOME, ".openclaw/agents"),
    amp: "amp-cli",
  },
  vault: join(HOME, "Desktop/Memory agent/vault"),
  dataDir: join(HOME, "Desktop/Memory agent/data"),
  sqlitePath: join(HOME, "Desktop/Memory agent/data/memory.db"),
  lanceDir: join(HOME, "Desktop/Memory agent/data/lance"),
  watchDebounceMs: 2000,
  maxSessionAgeDays: 7,
  llmModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small",
} as const;
