import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { dirname } from "path";
import { platform } from "os";
import { loadConfig } from "./config";

export interface ApiEmbeddingSettings {
  provider: "api";
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface LocalEmbeddingSettings {
  provider: "local";
  baseURL: string;
  model: string;
}

export interface JinaEmbeddingSettings {
  provider: "jina";
  apiKey: string;
  baseURL: string;
  model: string;
}

export type EmbeddingSettings =
  | ApiEmbeddingSettings
  | LocalEmbeddingSettings
  | JinaEmbeddingSettings;

interface BaseSettings {
  embedding?: EmbeddingSettings;
}

export interface ApiSettings extends BaseSettings {
  authMode: "api";
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface OAuthSettings extends BaseSettings {
  authMode: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  model: string;
}

export type Settings = ApiSettings | OAuthSettings;

interface LegacySettings {
  apiKey: string;
  baseURL: string;
  model: string;
}

interface StoredApiEmbeddingSettings {
  provider: "api";
  baseURL: string;
  model: string;
}

interface StoredLocalEmbeddingSettings {
  provider: "local";
  baseURL: string;
  model: string;
}

interface StoredJinaEmbeddingSettings {
  provider: "jina";
  baseURL: string;
  model: string;
}

type StoredEmbeddingSettings =
  | StoredApiEmbeddingSettings
  | StoredLocalEmbeddingSettings
  | StoredJinaEmbeddingSettings;

interface StoredApiSettings {
  version: 2;
  authMode: "api";
  baseURL: string;
  model: string;
  embedding?: StoredEmbeddingSettings;
}

interface StoredOAuthSettings {
  version: 2;
  authMode: "oauth";
  expiresAt: number;
  accountId?: string;
  model: string;
  embedding?: StoredEmbeddingSettings;
}

type StoredSettings = StoredApiSettings | StoredOAuthSettings;

interface SecretPayload {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  embeddingApiKey?: string;
}

type SecretBackend = "keychain" | "file";

function getSecretBackend(): SecretBackend {
  const override = process.env.MNEMONIC_SECRET_BACKEND;
  if (override === "file") {
    return "file";
  }
  if (override === "keychain") {
    return "keychain";
  }
  return platform() === "darwin" ? "keychain" : "file";
}

function getSecretsFilePath(settingsPath: string) {
  return `${settingsPath}.secrets.json`;
}

function getKeychainAccount(settingsPath: string) {
  return `settings:${settingsPath}`;
}

function readSecretsFromFile(settingsPath: string): SecretPayload {
  const secretsPath = getSecretsFilePath(settingsPath);
  if (!existsSync(secretsPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(secretsPath, "utf-8")) as SecretPayload;
  } catch {
    return {};
  }
}

function writeSecretsToFile(settingsPath: string, payload: SecretPayload) {
  const secretsPath = getSecretsFilePath(settingsPath);
  mkdirSync(dirname(secretsPath), { recursive: true });
  writeFileSync(secretsPath, JSON.stringify(payload, null, 2));
}

function removeSecretsFromFile(settingsPath: string) {
  const secretsPath = getSecretsFilePath(settingsPath);
  if (existsSync(secretsPath)) {
    rmSync(secretsPath, { force: true });
  }
}

function readSecretsFromKeychain(settingsPath: string): SecretPayload {
  const currentConfig = loadConfig();
  try {
    const stdout = execFileSync(
      "security",
      [
        "find-generic-password",
        "-s",
        currentConfig.appName,
        "-a",
        getKeychainAccount(settingsPath),
        "-w",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(stdout) as SecretPayload;
  } catch {
    return {};
  }
}

function writeSecretsToKeychain(settingsPath: string, payload: SecretPayload) {
  const currentConfig = loadConfig();
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-U",
      "-s",
      currentConfig.appName,
      "-a",
      getKeychainAccount(settingsPath),
      "-w",
      JSON.stringify(payload),
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

function removeSecretsFromKeychain(settingsPath: string) {
  const currentConfig = loadConfig();
  try {
    execFileSync(
      "security",
      [
        "delete-generic-password",
        "-s",
        currentConfig.appName,
        "-a",
        getKeychainAccount(settingsPath),
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
  } catch {}
}

function loadSecretPayload(settingsPath: string): SecretPayload {
  if (getSecretBackend() === "keychain") {
    return readSecretsFromKeychain(settingsPath);
  }
  return readSecretsFromFile(settingsPath);
}

function saveSecretPayload(settingsPath: string, payload: SecretPayload) {
  if (getSecretBackend() === "keychain") {
    writeSecretsToKeychain(settingsPath, payload);
    return;
  }
  writeSecretsToFile(settingsPath, payload);
}

function removeSecretPayload(settingsPath: string) {
  if (getSecretBackend() === "keychain") {
    removeSecretsFromKeychain(settingsPath);
    return;
  }
  removeSecretsFromFile(settingsPath);
}

export function getSettingsPath(): string {
  return process.env.MEMORY_AGENT_SETTINGS_PATH ?? loadConfig().settingsPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEmbeddingSettings(value: unknown): EmbeddingSettings | undefined {
  if (!isRecord(value) || typeof value.provider !== "string") {
    return undefined;
  }

  if (value.provider === "api") {
    return {
      provider: "api",
      apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : "https://api.openai.com/v1",
      model: typeof value.model === "string" ? value.model : "text-embedding-3-small",
    };
  }

  if (value.provider === "local") {
    return {
      provider: "local",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : "http://127.0.0.1:11434/v1",
      model: typeof value.model === "string" ? value.model : "nomic-embed-text",
    };
  }

  if (value.provider === "jina") {
    return {
      provider: "jina",
      apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : "https://api.jina.ai/v1",
      model: typeof value.model === "string" ? value.model : "jina-embeddings-v3",
    };
  }

  return undefined;
}

function normalizeStoredEmbeddingSettings(
  value: unknown,
  secrets: SecretPayload,
): EmbeddingSettings | undefined {
  if (!isRecord(value) || typeof value.provider !== "string") {
    return undefined;
  }

  if (value.provider === "api") {
    return {
      provider: "api",
      apiKey: secrets.embeddingApiKey ?? "",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : "https://api.openai.com/v1",
      model: typeof value.model === "string" ? value.model : "text-embedding-3-small",
    };
  }

  if (value.provider === "local") {
    return {
      provider: "local",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : "http://127.0.0.1:11434/v1",
      model: typeof value.model === "string" ? value.model : "nomic-embed-text",
    };
  }

  if (value.provider === "jina") {
    return {
      provider: "jina",
      apiKey: secrets.embeddingApiKey ?? "",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : "https://api.jina.ai/v1",
      model: typeof value.model === "string" ? value.model : "jina-embeddings-v3",
    };
  }

  return undefined;
}

function normalizeApiSettings(value: Record<string, unknown>): ApiSettings {
  const currentConfig = loadConfig();
  return {
    authMode: "api",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    baseURL: typeof value.baseURL === "string" ? value.baseURL : currentConfig.openaiBaseURL,
    model: typeof value.model === "string" ? value.model : currentConfig.llmModel,
    embedding: normalizeEmbeddingSettings(value.embedding),
  };
}

function normalizeOAuthSettings(value: Record<string, unknown>): OAuthSettings | null {
  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.expiresAt !== "number"
  ) {
    return null;
  }

  return {
    authMode: "oauth",
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    accountId: typeof value.accountId === "string" ? value.accountId : undefined,
    model: typeof value.model === "string" ? value.model : "gpt-5.4-mini",
    embedding: normalizeEmbeddingSettings(value.embedding),
  };
}

function normalizeStoredSettings(value: Record<string, unknown>, secrets: SecretPayload): Settings | null {
  const currentConfig = loadConfig();
  if (value.version !== 2) {
    return null;
  }

  if (value.authMode === "api") {
    return {
      authMode: "api",
      apiKey: secrets.apiKey ?? "",
      baseURL: typeof value.baseURL === "string" ? value.baseURL : currentConfig.openaiBaseURL,
      model: typeof value.model === "string" ? value.model : currentConfig.llmModel,
      embedding: normalizeStoredEmbeddingSettings(value.embedding, secrets),
    };
  }

  if (
    value.authMode === "oauth" &&
    typeof value.expiresAt === "number" &&
    typeof secrets.accessToken === "string" &&
    typeof secrets.refreshToken === "string"
  ) {
    return {
      authMode: "oauth",
      accessToken: secrets.accessToken,
      refreshToken: secrets.refreshToken,
      expiresAt: value.expiresAt,
      accountId: typeof value.accountId === "string" ? value.accountId : undefined,
      model: typeof value.model === "string" ? value.model : "gpt-5.4-mini",
      embedding: normalizeStoredEmbeddingSettings(value.embedding, secrets),
    };
  }

  return null;
}

function normalizeSettings(value: unknown, settingsPath: string): Settings | null {
  if (!isRecord(value)) return null;

  const storedSettings = normalizeStoredSettings(value, loadSecretPayload(settingsPath));
  if (storedSettings) {
    return storedSettings;
  }

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
    typeof legacy.model === "string"
  ) {
    return normalizeApiSettings(value);
  }

  return null;
}

function splitSettings(settings: Settings): { stored: StoredSettings; secrets: SecretPayload } {
  const embedding: StoredEmbeddingSettings | undefined = settings.embedding
    ? settings.embedding.provider === "local"
      ? {
          provider: "local",
          baseURL: settings.embedding.baseURL,
          model: settings.embedding.model,
        }
      : {
          provider: settings.embedding.provider,
          baseURL: settings.embedding.baseURL,
          model: settings.embedding.model,
        }
    : undefined;

  const embeddingApiKey =
    settings.embedding &&
    "apiKey" in settings.embedding &&
    settings.embedding.apiKey
      ? settings.embedding.apiKey
      : undefined;

  if (settings.authMode === "api") {
    return {
      stored: {
        version: 2,
        authMode: "api",
        baseURL: settings.baseURL,
        model: settings.model,
        embedding,
      },
      secrets: {
        apiKey: settings.apiKey,
        embeddingApiKey,
      },
    };
  }

  return {
    stored: {
      version: 2,
      authMode: "oauth",
      expiresAt: settings.expiresAt,
      accountId: settings.accountId,
      model: settings.model,
      embedding,
    },
    secrets: {
      accessToken: settings.accessToken,
      refreshToken: settings.refreshToken,
      embeddingApiKey,
    },
  };
}

export function loadSettings(): Settings | null {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) return null;
  try {
    return normalizeSettings(JSON.parse(readFileSync(settingsPath, "utf-8")), settingsPath);
  } catch {
    return null;
  }
}

export function saveSettings(settings: Settings): void {
  const settingsPath = getSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  const { stored, secrets } = splitSettings(settings);
  saveSecretPayload(settingsPath, secrets);
  writeFileSync(settingsPath, JSON.stringify(stored, null, 2));
}

export function removeSettings(): void {
  const settingsPath = getSettingsPath();
  removeSecretPayload(settingsPath);
  if (existsSync(settingsPath)) {
    rmSync(settingsPath);
  }
}
