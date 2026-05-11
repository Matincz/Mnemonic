import { appendStructuredLog } from "../logger";
import type { Config } from "../config";
import type { Settings } from "../settings";

export const LLM_LOG_PREVIEW_CHARS = 800;

export interface LlmLogInput {
  prompt: string;
  response?: string;
  startedAt: number;
  ok: boolean;
  error?: unknown;
  errorRaw?: string | null;
  kind: "text" | "json" | "oauth";
  schema?: string;
  component?: string;
  settings: Settings | null;
  config: Config;
}

export function recordLlmCall(input: LlmLogInput) {
  const response = input.response ?? "";
  const error = input.error instanceof Error ? input.error.message : input.error === undefined ? null : String(input.error);
  appendStructuredLog("llm", {
    ts: new Date().toISOString(),
    model: getModel(input.settings, input.config),
    baseURL: getBaseURL(input.settings, input.config),
    authMode: input.settings?.authMode ?? "api",
    kind: input.kind,
    schema: input.schema ?? null,
    promptChars: input.prompt.length,
    promptPreview: preview(input.prompt),
    responseChars: response.length,
    responsePreview: preview(response),
    durationMs: Math.max(0, Date.now() - input.startedAt),
    ok: input.ok,
    error,
    errorRaw: input.errorRaw ?? null,
    callerComponent: input.component ?? "unknown",
  });
}

export function preview(value: string) {
  return value.length > LLM_LOG_PREVIEW_CHARS ? value.slice(0, LLM_LOG_PREVIEW_CHARS) : value;
}

function getModel(settings: Settings | null, config: Config) {
  return settings?.model || config.llmModel;
}

function getBaseURL(settings: Settings | null, config: Config) {
  return settings?.authMode === "api" ? settings.baseURL || config.openaiBaseURL : config.openaiBaseURL;
}
