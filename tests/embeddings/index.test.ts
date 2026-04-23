import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("embedding provider cache", () => {
  const originalSettingsPath = process.env.MEMORY_AGENT_SETTINGS_PATH;
  const originalSecretBackend = process.env.MNEMONIC_SECRET_BACKEND;
  const roots: string[] = [];

  afterEach(async () => {
    const { removeSettings } = await import("../../src/settings");
    removeSettings();

    const { invalidateEmbeddingCache } = await import("../../src/embeddings");
    invalidateEmbeddingCache();

    process.env.MEMORY_AGENT_SETTINGS_PATH = originalSettingsPath;
    process.env.MNEMONIC_SECRET_BACKEND = originalSecretBackend;

    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses cached provider state until invalidated", async () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-embedding-cache-"));
    roots.push(root);
    process.env.MNEMONIC_SECRET_BACKEND = "file";
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");

    const { saveSettings, removeSettings } = await import("../../src/settings");
    const { hasEmbeddingProvider, invalidateEmbeddingCache } = await import("../../src/embeddings");

    saveSettings({
      authMode: "api",
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      embedding: {
        provider: "local",
        baseURL: "http://127.0.0.1:11434/v1",
        model: "nomic-embed-text",
      },
    });

    invalidateEmbeddingCache();
    expect(hasEmbeddingProvider()).toBe(true);

    removeSettings();
    expect(hasEmbeddingProvider()).toBe(true);

    invalidateEmbeddingCache();
    expect(hasEmbeddingProvider()).toBe(false);
  });
});
