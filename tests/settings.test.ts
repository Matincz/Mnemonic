import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("settings", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memory-agent-settings-"));
    settingsPath = join(tempDir, "settings.json");
    process.env.MEMORY_AGENT_SETTINGS_PATH = settingsPath;
  });

  afterEach(() => {
    delete process.env.MEMORY_AGENT_SETTINGS_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads legacy api-key settings as api mode", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        apiKey: "sk-legacy",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        embeddingModel: "text-embedding-3-small",
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
      embeddingModel: "text-embedding-3-small",
      apiKey: "sk-embed",
      baseURL: "https://api.openai.com/v1",
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
      embeddingModel: "text-embedding-3-small",
      apiKey: "sk-embed",
      baseURL: "https://api.openai.com/v1",
    });
  });
});
