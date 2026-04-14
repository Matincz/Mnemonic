import { generateText, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config";
import { loadSettings, saveSettings, type OAuthSettings, type Settings } from "../settings";
import {
  buildCodexHeaders,
  extractResponseText,
  getCodexApiEndpoint,
  refreshOAuthTokensIfNeeded,
} from "./openai-auth";

function getApiCredentials(settings: Settings | null): { apiKey: string; baseURL: string } {
  if (settings?.authMode === "api") {
    return {
      apiKey: settings.apiKey || config.openaiApiKey,
      baseURL: settings.baseURL || config.openaiBaseURL,
    };
  }

  if (settings?.authMode === "oauth") {
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

function getChatModel(settings: Settings | null): string {
  return settings?.model || config.llmModel;
}

function getEmbeddingModel(settings: Settings | null): string {
  return settings?.embeddingModel || config.embeddingModel;
}

function createApiClient(settings: Settings | null) {
  const { apiKey, baseURL } = getApiCredentials(settings);
  return createOpenAI({ apiKey, baseURL });
}

async function generateWithOAuth(prompt: string, settings: OAuthSettings): Promise<string> {
  const refreshed = await refreshOAuthTokensIfNeeded(settings);
  if (
    refreshed.accessToken !== settings.accessToken ||
    refreshed.refreshToken !== settings.refreshToken ||
    refreshed.expiresAt !== settings.expiresAt ||
    refreshed.accountId !== settings.accountId
  ) {
    saveSettings(refreshed);
  }

  const response = await fetch(getCodexApiEndpoint(), {
    method: "POST",
    headers: buildCodexHeaders(refreshed.accessToken, refreshed.accountId),
    body: JSON.stringify({
      model: refreshed.model,
      input: prompt,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ChatGPT OAuth request failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }

  return extractResponseText(await response.json());
}

export async function llmGenerate(prompt: string): Promise<string> {
  const settings = loadSettings();
  if (settings?.authMode === "oauth") {
    return generateWithOAuth(prompt, settings);
  }

  const openai = createApiClient(settings);
  const { text } = await generateText({
    model: openai(getChatModel(settings)),
    prompt,
    temperature: 0.3,
  });
  return text;
}

export async function llmGenerateJSON<T>(prompt: string): Promise<T> {
  const text = await llmGenerate(prompt);
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonStr = jsonMatch[1]?.trim() ?? text.trim();
  return JSON.parse(jsonStr);
}

export async function getEmbedding(text: string): Promise<number[]> {
  const settings = loadSettings();
  const { apiKey, baseURL } = getApiCredentials(settings);
  if (!apiKey) {
    throw new Error("Embeddings require an OpenAI API key. Configure one in setup or set OPENAI_API_KEY.");
  }

  const openai = createOpenAI({ apiKey, baseURL });
  const { embedding } = await embed({
    model: openai.embedding(getEmbeddingModel(settings)),
    value: text,
  });
  return embedding;
}
