import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { configureLogger } from "../src/logger";
import { LLM_LOG_PREVIEW_CHARS, recordLlmCall } from "../src/llm/log";
import type { Config } from "../src/config";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeLogsDir() {
  const dir = mkdtempSync(join(tmpdir(), "mnemonic-test-llm-logs-"));
  tempDirs.push(dir);
  configureLogger({
    logsDir: dir,
    level: "debug",
    console: false,
    retentionDays: 7,
    dateProvider: () => new Date("2026-05-11T12:00:00.000Z"),
  });
  return dir;
}

function makeConfig(logsDir: string): Config {
  return {
    appName: "Mnemonic",
    sources: {
      codex: "/tmp/codex",
      claudeCode: "/tmp/claude",
      gemini: "/tmp/gemini",
      opencode: "/tmp/opencode.db",
      openclaw: "/tmp/openclaw",
      amp: "amp-cli",
    },
    dataRoot: "/tmp/mnemonic",
    configRoot: "/tmp/mnemonic-config",
    vault: "/tmp/mnemonic/vault",
    dataDir: "/tmp/mnemonic/data",
    sqlitePath: "/tmp/mnemonic/data/memory.db",
    lanceDir: "/tmp/mnemonic/data/lance",
    settingsPath: "/tmp/mnemonic-config/settings.json",
    logsDir,
    ipcDir: "/tmp/mnemonic/ipc",
    ipcStatusPath: "/tmp/mnemonic/ipc/status.json",
    ipcEventsPath: "/tmp/mnemonic/ipc/events.ndjson",
    logLevel: "debug",
    logRetentionDays: 7,
    logConsole: false,
    watchDebounceMs: 2000,
    maxSessionAgeDays: 7,
    automaticDeduplicateSessionInterval: 25,
    vectorBackend: "sqlite",
    llmModel: "fallback-model",
    openaiApiKey: "",
    openaiBaseURL: "https://api.openai.com/v1",
  };
}

function readRecord(logsDir: string) {
  const line = readFileSync(join(logsDir, "llm-2026-05-11.ndjson"), "utf8").trim().split("\n").at(-1)!;
  return JSON.parse(line) as Record<string, unknown>;
}

describe("llm call logging", () => {
  it("records successful calls with duration and truncated previews", () => {
    const logsDir = makeLogsDir();
    const prompt = "p".repeat(LLM_LOG_PREVIEW_CHARS + 20);
    const response = "r".repeat(LLM_LOG_PREVIEW_CHARS + 30);

    recordLlmCall({
      prompt,
      response,
      startedAt: Date.now() - 25,
      ok: true,
      kind: "json",
      schema: "RawMemorySchema",
      component: "ingestor",
      settings: {
        authMode: "api",
        apiKey: "key",
        baseURL: "http://localhost:10240/v1",
        model: "qwen3.5-9b-mlx-4bit",
      },
      config: makeConfig(logsDir),
    });

    const record = readRecord(logsDir);
    expect(record.ok).toBe(true);
    expect(record.model).toBe("qwen3.5-9b-mlx-4bit");
    expect(record.baseURL).toBe("http://localhost:10240/v1");
    expect(record.kind).toBe("json");
    expect(record.schema).toBe("RawMemorySchema");
    expect(record.promptChars).toBe(prompt.length);
    expect(record.responseChars).toBe(response.length);
    expect(String(record.promptPreview).length).toBe(LLM_LOG_PREVIEW_CHARS);
    expect(String(record.responsePreview).length).toBe(LLM_LOG_PREVIEW_CHARS);
    expect(Number(record.durationMs)).toBeGreaterThanOrEqual(0);
    expect(record.error).toBeNull();
    expect(record.errorRaw).toBeNull();
    expect(record.callerComponent).toBe("ingestor");
  });

  it("records failed fetch or HTTP-style errors with raw error detail", () => {
    const logsDir = makeLogsDir();

    recordLlmCall({
      prompt: "prompt",
      startedAt: Date.now(),
      ok: false,
      kind: "text",
      component: "query",
      settings: null,
      config: makeConfig(logsDir),
      error: new Error("HTTP 500"),
      errorRaw: "upstream body",
    });

    const record = readRecord(logsDir);
    expect(record.ok).toBe(false);
    expect(record.error).toBe("HTTP 500");
    expect(record.errorRaw).toBe("upstream body");
  });

  it("records full raw model output for zod failure diagnostics", () => {
    const logsDir = makeLogsDir();
    const raw = JSON.stringify(["over-escaped object"]);

    recordLlmCall({
      prompt: "prompt",
      response: raw,
      startedAt: Date.now(),
      ok: false,
      kind: "json",
      schema: "RawMemorySchema",
      component: "ingestor",
      settings: null,
      config: makeConfig(logsDir),
      error: new Error("Expected object"),
      errorRaw: raw,
    });

    const record = readRecord(logsDir);
    expect(record.ok).toBe(false);
    expect(record.errorRaw).toBe(raw);
    expect(record.responseChars).toBe(raw.length);
  });
});
