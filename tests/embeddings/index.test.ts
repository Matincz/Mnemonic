import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("embedding provider cache", () => {
  const originalSettingsPath = process.env.MEMORY_AGENT_SETTINGS_PATH;
  const originalSecretBackend = process.env.MNEMONIC_SECRET_BACKEND;
  const originalFetch = globalThis.fetch;
  const roots: string[] = [];

  afterEach(async () => {
    const { removeSettings } = await import("../../src/settings");
    removeSettings();

    const embeddingsModule = "../../src/embeddings/index.ts?spec=embedding-cache-test";
    const { invalidateEmbeddingCache } = await import(embeddingsModule);
    invalidateEmbeddingCache();

    process.env.MEMORY_AGENT_SETTINGS_PATH = originalSettingsPath;
    process.env.MNEMONIC_SECRET_BACKEND = originalSecretBackend;
    globalThis.fetch = originalFetch;

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
    const embeddingsModule = "../../src/embeddings/index.ts?spec=embedding-cache-test";
    const { hasEmbeddingProvider, invalidateEmbeddingCache } = await import(embeddingsModule);

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

  it("enters cooldown after an embedding rate limit and avoids another fetch", async () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-embedding-rate-limit-"));
    roots.push(root);
    process.env.MNEMONIC_SECRET_BACKEND = "file";
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");

    const { saveSettings } = await import("../../src/settings");
    const embeddingsModule = "../../src/embeddings/index.ts?spec=embedding-rate-limit-test";
    const { embedTexts, invalidateEmbeddingCache } = await import(embeddingsModule);

    saveSettings({
      authMode: "api",
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      embedding: {
        provider: "jina",
        apiKey: "jina-test",
        baseURL: "https://api.jina.ai/v1",
        model: "jina-embeddings-v3",
      },
    });

    invalidateEmbeddingCache();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          code: "RATE_TOKEN_LIMIT_EXCEEDED",
          detail: "Token rate limit exceeded",
        }),
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    await expect(embedTexts(["first"])).rejects.toThrow("HTTP 429");
    await expect(embedTexts(["second"])).rejects.toThrow("Embedding provider is cooling down");
    expect(fetchCalls).toBe(1);
  });

  it("reports no embedding provider while rate limited", async () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-embedding-provider-cooldown-"));
    roots.push(root);
    process.env.MNEMONIC_SECRET_BACKEND = "file";
    process.env.MEMORY_AGENT_SETTINGS_PATH = join(root, "settings.json");

    const { saveSettings } = await import("../../src/settings");
    const embeddingsModule = "../../src/embeddings/index.ts?spec=embedding-provider-cooldown-test";
    const { embedTexts, hasEmbeddingProvider, invalidateEmbeddingCache } = await import(embeddingsModule);

    saveSettings({
      authMode: "api",
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      embedding: {
        provider: "jina",
        apiKey: "jina-test",
        baseURL: "https://api.jina.ai/v1",
        model: "jina-embeddings-v3",
      },
    });

    invalidateEmbeddingCache();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: "RATE_TOKEN_LIMIT_EXCEEDED",
          detail: "Token rate limit exceeded",
        }),
        { status: 429 },
      )) as unknown as typeof fetch;

    expect(hasEmbeddingProvider()).toBe(true);
    await expect(embedTexts(["first"])).rejects.toThrow("HTTP 429");
    expect(hasEmbeddingProvider()).toBe(false);
  });
});
