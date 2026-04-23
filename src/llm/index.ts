import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { loadConfig, type Config } from "../config";
import { loadSettings, saveSettings, type OAuthSettings, type Settings } from "../settings";
import {
  buildCodexHeaders,
  extractResponseText,
  getCodexApiEndpoint,
  refreshOAuthTokensIfNeeded,
} from "./openai-auth";

export interface LlmCallOptions {
  settings?: Settings | null;
  config?: Config;
}

function getApiCredentials(settings: Settings | null, config: Config): { apiKey: string; baseURL: string } {
  if (settings?.authMode === "api") {
    return {
      apiKey: settings.apiKey || config.openaiApiKey,
      baseURL: settings.baseURL || config.openaiBaseURL,
    };
  }

  return {
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseURL,
  };
}

function getChatModel(settings: Settings | null, config: Config): string {
  return settings?.model || config.llmModel;
}

function createApiClient(settings: Settings | null, config: Config) {
  const { apiKey, baseURL } = getApiCredentials(settings, config);
  const wrappedFetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.enable_thinking = false;
        init = { ...init, body: JSON.stringify(body) };
      } catch {}
    }
    return fetch(url, init);
  }) as typeof fetch;

  return createOpenAI({
    apiKey,
    baseURL,
    fetch: wrappedFetch,
  });
}

async function generateWithOAuth(prompt: string, settings: OAuthSettings): Promise<string> {
  const refreshed = await refreshOAuthTokensIfNeeded(settings);
  if (
    refreshed.accessToken !== settings.accessToken ||
    refreshed.refreshToken !== settings.refreshToken ||
    refreshed.expiresAt !== settings.expiresAt ||
    refreshed.accountId !== settings.accountId
  ) {
    saveSettings({
      ...settings,
      ...refreshed,
      embedding: settings.embedding,
    });
  }

  const response = await fetch(getCodexApiEndpoint(), {
    method: "POST",
    headers: buildCodexHeaders(refreshed.accessToken, refreshed.accountId),
    body: JSON.stringify({
      model: refreshed.model,
      instructions: "You are a helpful assistant.",
      input: [{ type: "message", role: "user", content: prompt }],
      store: false,
      stream: true
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ChatGPT OAuth request failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }

  return await extractResponseText(response);
}

export async function llmGenerate(prompt: string, options: LlmCallOptions = {}): Promise<string> {
  const settings = options.settings ?? loadSettings();
  const config = options.config ?? loadConfig();
  if (settings?.authMode === "oauth") {
    return generateWithOAuth(prompt, settings);
  }

  const openai = createApiClient(settings, config);
  const { text } = await generateText({
    model: openai(getChatModel(settings, config)),
    prompt,
    temperature: 0.3,
  });
  return text;
}

export function extractJSONFromText(text: string): string {
  const fencedJsonMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJsonMatch?.[1]) {
    return fencedJsonMatch[1].trim();
  }

  const genericFenceMatches = [...text.matchAll(/```(?:[^\n`]*)\n?([\s\S]*?)```/g)];
  for (const match of genericFenceMatches) {
    const candidate = match[1]?.trim();
    if (!candidate) {
      continue;
    }

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  const startIndexes = [...text.matchAll(/[{\[]/g)].map((match) => match.index ?? -1).filter((index) => index >= 0);
  for (const startIndex of startIndexes) {
    for (let endIndex = text.length; endIndex > startIndex; endIndex -= 1) {
      const candidate = text.slice(startIndex, endIndex).trim();
      if (!candidate) {
        continue;
      }

      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return text.trim();
}

function unescapeOverescapedJSON(text: string): string {
  if (
    !text.includes('\\"') &&
    !text.startsWith("\\[") &&
    !text.startsWith("\\{")
  ) {
    return text;
  }

  return text
    .replace(/^\\(?=[\[{])/, "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export function parseJSONWithRecovery(text: string): unknown {
  const seen = new Set<string>();
  const queue = [text.trim()];
  let lastError: Error | null = null;

  while (queue.length > 0) {
    const candidate = queue.shift()!.trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        queue.push(parsed);
        const extractedFromString = extractJSONFromText(parsed);
        if (extractedFromString !== parsed) {
          queue.push(extractedFromString);
        }
        continue;
      }
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    const extracted = extractJSONFromText(candidate);
    if (extracted !== candidate) {
      queue.push(extracted);
    }

    const unescaped = unescapeOverescapedJSON(candidate);
    if (unescaped !== candidate) {
      queue.push(unescaped);
    }
  }

  throw lastError ?? new Error("Unable to parse JSON from model output.");
}

function tryParseJSONObjectString(value: string): unknown {
  try {
    return parseJSONWithRecovery(value);
  } catch {
    return value;
  }
}

/**
 * Normalize LLM output that should be an array of objects.
 * Handles: single object, wrapped array ({items:[...]}), and arrays with stringified object elements.
 */
export function normalizeArrayResponse(parsed: unknown): unknown[] {
  // Already an array — filter out non-object elements
  if (Array.isArray(parsed)) {
    const normalizedItems = parsed.map((item) =>
      typeof item === "string" ? tryParseJSONObjectString(item) : item
    );
    const objects = normalizedItems.filter((item) => typeof item === "object" && item !== null);
    return objects.length > 0 ? objects : parsed;
  }

  // Single object — check for a nested array value or wrap it
  if (typeof parsed === "object" && parsed !== null) {
    const values = Object.values(parsed);
    const arrayValue = values.find((v) => Array.isArray(v));
    if (arrayValue) {
      return normalizeArrayResponse(arrayValue);
    }
    return [parsed];
  }

  return [];
}

export async function llmGenerateJSON<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: LlmCallOptions = {},
): Promise<T> {
  const settings = options.settings ?? loadSettings();
  const config = options.config ?? loadConfig();

  if (settings?.authMode === "oauth") {
    const text = await generateWithOAuth(prompt, settings);
    const jsonStr = extractJSONFromText(text);
    return schema.parse(parseJSONWithRecovery(jsonStr));
  }

  const openai = createApiClient(settings, config);

  // When the top-level schema is an array, some providers return {items:[...]}
  // which causes validation errors. Use generateText + manual JSON parse as a
  // reliable fallback for array schemas.
  if (schema instanceof z.ZodArray) {
    const { text } = await generateText({
      model: openai(getChatModel(settings, config)),
      prompt,
      temperature: 0.3,
    });
    const jsonStr = extractJSONFromText(text);
    const parsed = parseJSONWithRecovery(jsonStr);
    const normalized = normalizeArrayResponse(parsed);
    return schema.parse(normalized) as T;
  }

  const { object } = await generateObject({
    model: openai(getChatModel(settings, config)),
    prompt,
    schema,
    temperature: 0.3,
  });

  return object;
}
