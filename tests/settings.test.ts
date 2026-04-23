import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("settings", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memory-agent-settings-"));
    settingsPath = join(tempDir, "settings.json");
    process.env.MEMORY_AGENT_SETTINGS_PATH = settingsPath;
    process.env.MNEMONIC_SECRET_BACKEND = "file";
  });

  afterEach(() => {
    delete process.env.MEMORY_AGENT_SETTINGS_PATH;
    delete process.env.MNEMONIC_SECRET_BACKEND;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads legacy api-key settings as api mode", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        apiKey: "sk-legacy",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
      }),
    );

    const { loadSettings } = await import("../src/settings");
    const settings = loadSettings();

    expect(settings).not.toBeNull();
    if (!settings) {
      throw new Error("expected settings to load");
    }
    expect(settings.authMode).toBe("api");
    if (settings.authMode === "api") {
      expect(settings.apiKey).toBe("sk-legacy");
      expect(Object.keys(settings).sort()).toEqual(["apiKey", "authMode", "baseURL", "embedding", "model"]);
      expect(settings.embedding).toBeUndefined();
    }
  });

  it("round-trips oauth settings", async () => {
    const { loadSettings, saveSettings } = await import("../src/settings");

    saveSettings({
      authMode: "oauth",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: 123456789,
      accountId: "acct_123",
      model: "gpt-5.4",
    });

    const settings = loadSettings();

    expect(settings).not.toBeNull();
    expect(settings).toEqual({
      authMode: "oauth",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: 123456789,
      accountId: "acct_123",
      model: "gpt-5.4",
      embedding: undefined,
    });

    const stored = readFileSync(settingsPath, "utf-8");
    expect(stored).not.toContain("access-token");
    expect(stored).not.toContain("refresh-token");
  });

  it("round-trips settings with jina embedding config", async () => {
    const { loadSettings, saveSettings } = await import("../src/settings");

    saveSettings({
      authMode: "api",
      apiKey: "sk-openai",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      embedding: {
        provider: "jina",
        apiKey: "jina_secret",
        baseURL: "https://api.jina.ai/v1",
        model: "jina-embeddings-v3",
      },
    });

    expect(loadSettings()).toEqual({
      authMode: "api",
      apiKey: "sk-openai",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      embedding: {
        provider: "jina",
        apiKey: "jina_secret",
        baseURL: "https://api.jina.ai/v1",
        model: "jina-embeddings-v3",
      },
    });

    const stored = readFileSync(settingsPath, "utf-8");
    expect(stored).not.toContain("sk-openai");
    expect(stored).not.toContain("jina_secret");
  });
});
