import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { config } from "./config";

export interface ApiSettings {
  authMode: "api";
  apiKey: string;
  baseURL: string;
  model: string;
  embeddingModel: string;
}

export interface OAuthSettings {
  authMode: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  model: string;
  embeddingModel: string;
  apiKey?: string;
  baseURL?: string;
}

export type Settings = ApiSettings | OAuthSettings;

interface LegacySettings {
  apiKey: string;
  baseURL: string;
  model: string;
  embeddingModel: string;
}

export function getSettingsPath(): string {
  return process.env.MEMORY_AGENT_SETTINGS_PATH ?? config.settingsPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeApiSettings(value: Record<string, unknown>): ApiSettings {
  return {
    authMode: "api",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    baseURL: typeof value.baseURL === "string" ? value.baseURL : config.openaiBaseURL,
    model: typeof value.model === "string" ? value.model : config.llmModel,
    embeddingModel: typeof value.embeddingModel === "string" ? value.embeddingModel : config.embeddingModel,
  };
}

function normalizeOAuthSettings(value: Record<string, unknown>): OAuthSettings | null {
  if (typeof value.accessToken !== "string" || typeof value.refreshToken !== "string" || typeof value.expiresAt !== "number") {
    return null;
  }

  return {
    authMode: "oauth",
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    accountId: typeof value.accountId === "string" ? value.accountId : undefined,
    model: typeof value.model === "string" ? value.model : "gpt-5.4-mini",
    embeddingModel: typeof value.embeddingModel === "string" ? value.embeddingModel : config.embeddingModel,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
    baseURL: typeof value.baseURL === "string" ? value.baseURL : config.openaiBaseURL,
  };
}

function normalizeSettings(value: unknown): Settings | null {
  if (!isRecord(value)) return null;

  if (value.authMode === "oauth") {
    return normalizeOAuthSettings(value);
  }

  if (value.authMode === "api") {
    return normalizeApiSettings(value);
  }

  const legacy = value as Partial<LegacySettings>;
  if (
    typeof legacy.apiKey === "string" ||
    typeof legacy.baseURL === "string" ||
    typeof legacy.model === "string" ||
    typeof legacy.embeddingModel === "string"
  ) {
    return normalizeApiSettings(value);
  }

  return null;
}

export function loadSettings(): Settings | null {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) return null;
  try {
    return normalizeSettings(JSON.parse(readFileSync(settingsPath, "utf-8")));
  } catch {
    return null;
  }
}

export function saveSettings(settings: Settings): void {
  const settingsPath = getSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function removeSettings(): void {
  const settingsPath = getSettingsPath();
  if (existsSync(settingsPath)) {
    rmSync(settingsPath);
  }
}
