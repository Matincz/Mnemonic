import { loadConfig, type Config } from "../config";
import { loadSettings, type EmbeddingSettings, type Settings } from "../settings";

export interface EmbeddingVector {
  model: string;
  values: number[];
}

export interface EmbeddingOptions {
  settings?: Settings | null;
  config?: Config;
}

let cachedHasProvider: boolean | null = null;

function resolveEmbeddingConfig(settings: Settings | null): EmbeddingSettings | null {
  return settings?.embedding ?? null;
}

function buildAuthHeaders(embedding: EmbeddingSettings, settings: Settings | null, config: Config) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if ("apiKey" in embedding && embedding.apiKey) {
    headers.Authorization = `Bearer ${embedding.apiKey}`;
    return headers;
  }

  if (settings?.authMode === "api" && settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  } else if (config.openaiApiKey) {
    headers.Authorization = `Bearer ${config.openaiApiKey}`;
  }

  return headers;
}

function sanitizeInput(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

async function fetchEmbeddings(
  input: string[],
  embedding: EmbeddingSettings,
  settings: Settings | null,
  config: Config,
) {
  const url = `${embedding.baseURL.replace(/\/+$/, "")}/embeddings`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders(embedding, settings, config),
    body: JSON.stringify({
      model: embedding.model,
      input,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embedding request failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };

  if (!Array.isArray(payload.data) || payload.data.length !== input.length) {
    throw new Error("Embedding response did not return a vector for each input.");
  }

  return payload.data.map((item) => {
    if (!Array.isArray(item.embedding)) {
      throw new Error("Embedding response item is missing a numeric vector.");
    }

    return {
      model: embedding.model,
      values: item.embedding,
    };
  });
}

export function hasEmbeddingProvider(settings?: Settings | null, _config?: Config) {
  if (cachedHasProvider !== null && settings === undefined) {
    return cachedHasProvider;
  }

  const resolvedSettings = settings === undefined ? loadSettings() : settings;
  const result = resolveEmbeddingConfig(resolvedSettings) !== null;
  if (settings === undefined) {
    cachedHasProvider = result;
  }

  return result;
}

export function invalidateEmbeddingCache() {
  cachedHasProvider = null;
}

export async function embedTexts(input: string[], options: EmbeddingOptions = {}): Promise<EmbeddingVector[]> {
  const settings = options.settings ?? loadSettings();
  const config = options.config ?? loadConfig();
  const embedding = resolveEmbeddingConfig(settings);
  if (!embedding) {
    throw new Error("Embeddings are not configured. Run `mnemonic setup` first.");
  }

  const cleaned = input.map(sanitizeInput).filter(Boolean);
  if (cleaned.length === 0) {
    return [];
  }

  return fetchEmbeddings(cleaned, embedding, settings, config);
}

export async function embedText(input: string, options: EmbeddingOptions = {}): Promise<EmbeddingVector> {
  const [vector] = await embedTexts([input], options);
  if (!vector) {
    throw new Error("No embedding vector returned.");
  }
  return vector;
}
