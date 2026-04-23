import React, { useEffect, useMemo, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  authenticateWithOpenAIBrowser,
  authenticateWithOpenAIHeadless,
  type OAuthLoginResult,
} from "../llm/openai-auth";
import { prepareRuntime } from "../migration";
import {
  loadSettings,
  saveSettings,
  type ApiSettings,
  type EmbeddingSettings,
  type OAuthSettings,
  type Settings,
} from "../settings";

type AuthMethod = "oauth-browser" | "oauth-headless" | "api";
type EmbeddingProvider = "api" | "local" | "jina";
type FieldKey =
  | "apiKey"
  | "baseURL"
  | "model"
  | "embeddingProvider"
  | "embeddingApiKey"
  | "embeddingBaseURL"
  | "embeddingModel";
type Phase = "authSelect" | "authenticating" | "input" | "confirm" | "testing" | "result";

interface StepConfig {
  key: FieldKey;
  label: string;
  defaultValue: string;
  masked: boolean;
  optional?: boolean;
  hint?: string;
}

const AUTH_OPTIONS: Array<{ key: AuthMethod; label: string; hint: string }> = [
  {
    key: "oauth-browser",
    label: "ChatGPT Plus/Pro (browser)",
    hint: "Opens a browser and waits for localhost callback",
  },
  {
    key: "oauth-headless",
    label: "ChatGPT Plus/Pro (headless)",
    hint: "Shows a code for manual device login",
  },
  {
    key: "api",
    label: "Manual API Key",
    hint: "Uses the standard OpenAI-compatible API key flow",
  },
];

const API_STEPS: StepConfig[] = [
  { key: "apiKey", label: "API Key", defaultValue: "", masked: true, hint: "Required" },
  { key: "baseURL", label: "Base URL", defaultValue: "https://api.openai.com/v1", masked: false },
  { key: "model", label: "Chat Model", defaultValue: "gpt-4.1-mini", masked: false },
];

const OAUTH_STEPS: StepConfig[] = [
  { key: "model", label: "Chat Model", defaultValue: "gpt-5.4-mini", masked: false },
];

type FormValues = Record<FieldKey, string>;

function getDefaultEmbeddingBaseURL(provider: EmbeddingProvider) {
  if (provider === "api") return "https://api.openai.com/v1";
  if (provider === "jina") return "https://api.jina.ai/v1";
  return "http://127.0.0.1:11434/v1";
}

function getDefaultEmbeddingModel(provider: EmbeddingProvider) {
  if (provider === "api") return "text-embedding-3-small";
  if (provider === "jina") return "jina-embeddings-v3";
  return "nomic-embed-text";
}

function normalizeEmbeddingProvider(value: string): EmbeddingProvider {
  if (value === "api" || value === "local" || value === "jina") {
    return value;
  }

  return "local";
}

function getEmbeddingSteps(provider: EmbeddingProvider): StepConfig[] {
  const steps: StepConfig[] = [
    {
      key: "embeddingProvider",
      label: "Embedding Provider",
      defaultValue: provider,
      masked: false,
      hint: "Supported values: api, local, jina",
    },
  ];

  if (provider !== "local") {
    steps.push({
      key: "embeddingApiKey",
      label: "Embedding API Key",
      defaultValue: "",
      masked: true,
      hint: provider === "jina" ? "Required for Jina embeddings" : "Required for the embedding API",
    });
  }

  steps.push(
    {
      key: "embeddingBaseURL",
      label: "Embedding Base URL",
      defaultValue: getDefaultEmbeddingBaseURL(provider),
      masked: false,
    },
    {
      key: "embeddingModel",
      label: "Embedding Model",
      defaultValue: getDefaultEmbeddingModel(provider),
      masked: false,
    },
  );

  return steps;
}

function getStepsForState(authMethod: AuthMethod | null, values: FormValues): StepConfig[] {
  const authSteps = authMethod === "api" ? API_STEPS : authMethod ? OAUTH_STEPS : [];
  const provider = normalizeEmbeddingProvider(values.embeddingProvider);
  return [...authSteps, ...getEmbeddingSteps(provider)];
}

function getInitialValues(existing: Settings | null): FormValues {
  const embeddingProvider = existing?.embedding?.provider ?? "local";
  const embeddingBaseURL = existing?.embedding?.baseURL ?? getDefaultEmbeddingBaseURL(embeddingProvider);
  const embeddingModel = existing?.embedding?.model ?? getDefaultEmbeddingModel(embeddingProvider);
  const embeddingApiKey =
    existing?.embedding && "apiKey" in existing.embedding
      ? existing.embedding.apiKey
      : existing?.authMode === "api"
        ? existing.apiKey
        : "";

  if (existing?.authMode === "api") {
    return {
      apiKey: existing.apiKey,
      baseURL: existing.baseURL,
      model: existing.model,
      embeddingProvider,
      embeddingApiKey,
      embeddingBaseURL,
      embeddingModel,
    };
  }

  if (existing?.authMode === "oauth") {
    return {
      apiKey: "",
      baseURL: "https://api.openai.com/v1",
      model: existing.model,
      embeddingProvider,
      embeddingApiKey,
      embeddingBaseURL,
      embeddingModel,
    };
  }

  return {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    embeddingProvider,
    embeddingApiKey,
    embeddingBaseURL,
    embeddingModel,
  };
}

function buildEmbeddingSettings(values: FormValues): EmbeddingSettings {
  const provider = normalizeEmbeddingProvider(values.embeddingProvider);

  if (provider === "local") {
    return {
      provider,
      baseURL: values.embeddingBaseURL || getDefaultEmbeddingBaseURL(provider),
      model: values.embeddingModel || getDefaultEmbeddingModel(provider),
    };
  }

  return {
    provider,
    apiKey: values.embeddingApiKey,
    baseURL: values.embeddingBaseURL || getDefaultEmbeddingBaseURL(provider),
    model: values.embeddingModel || getDefaultEmbeddingModel(provider),
  };
}

function buildSettings(
  method: AuthMethod,
  values: FormValues,
  oauth: OAuthLoginResult | null,
): Settings {
  const embedding = buildEmbeddingSettings(values);

  if (method === "api") {
    const settings: ApiSettings = {
      authMode: "api",
      apiKey: values.apiKey,
      baseURL: values.baseURL || "https://api.openai.com/v1",
      model: values.model || "gpt-4.1-mini",
      embedding,
    };
    return settings;
  }

  if (!oauth) {
    throw new Error("Missing OAuth login result");
  }

  const settings: OAuthSettings = {
    authMode: "oauth",
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    accountId: oauth.accountId,
    model: values.model || "gpt-5.4-mini",
    embedding,
  };

  return settings;
}

async function testApiConnection(settings: ApiSettings): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${settings.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    const msg = (body as any)?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, error: msg };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

async function testEmbeddingConnection(settings: EmbeddingSettings): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if ("apiKey" in settings && settings.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
    }

    const url = `${settings.baseURL.replace(/\/+$/, "")}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        input: "Mnemonic embedding probe",
      }),
    });

    if (res.ok) {
      return { ok: true };
    }

    const body = await res.json().catch(() => ({}));
    const msg = (body as any)?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, error: msg };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

async function testSetupConfiguration(settings: Settings): Promise<{ ok: boolean; error?: string }> {
  if (settings.authMode === "api") {
    const chatResult = await testApiConnection(settings);
    if (!chatResult.ok) {
      return {
        ok: false,
        error: `Chat API test failed: ${chatResult.error}`,
      };
    }
  }

  const embeddingResult = await testEmbeddingConnection(settings.embedding!);
  if (!embeddingResult.ok) {
    return {
      ok: false,
      error: `Embedding API test failed: ${embeddingResult.error}`,
    };
  }

  return { ok: true };
}

function Setup() {
  const { exit } = useApp();
  const existing = loadSettings();

  const [phase, setPhase] = useState<Phase>("authSelect");
  const [selectedAuthIndex, setSelectedAuthIndex] = useState(
    existing?.authMode === "oauth" ? 0 : 2,
  );
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<FormValues>(getInitialValues(existing));
  const [currentInput, setCurrentInput] = useState("");
  const [oauthResult, setOAuthResult] = useState<OAuthLoginResult | null>(
    existing?.authMode === "oauth"
      ? {
          accessToken: existing.accessToken,
          refreshToken: existing.refreshToken,
          expiresAt: existing.expiresAt,
          accountId: existing.accountId,
        }
      : null,
  );
  const [authMessage, setAuthMessage] = useState<string>("Waiting to start authentication...");
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const steps = useMemo(() => getStepsForState(authMethod, values), [authMethod, values]);
  const step = steps[stepIndex];

  useEffect(() => {
    if (phase !== "authenticating" || !authMethod) return;

    let cancelled = false;

    (async () => {
      try {
        const oauth =
          authMethod === "oauth-browser"
            ? await authenticateWithOpenAIBrowser((url) => {
                if (!cancelled) {
                  setAuthMessage(
                    `Open this URL in your browser if it did not launch automatically:\n${url}`,
                  );
                }
              })
            : await authenticateWithOpenAIHeadless((prompt) => {
                if (!cancelled) {
                  setAuthMessage(`Visit ${prompt.verificationUrl}\nEnter code: ${prompt.userCode}`);
                }
              });

        if (cancelled) return;
        setOAuthResult(oauth);
        setStepIndex(0);
        const firstStep = getStepsForState(authMethod, values)[0] ?? OAUTH_STEPS[0];
        setCurrentInput(values[firstStep.key] || firstStep.defaultValue);
        setPhase("input");
      } catch (err: any) {
        if (cancelled) return;
        setTestResult({ ok: false, error: err?.message ?? String(err) });
        setPhase("result");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, authMethod, values]);

  useEffect(() => {
    if (phase !== "testing" || !authMethod) return;
    let cancelled = false;

    const settings = buildSettings(authMethod, values, oauthResult);
    testSetupConfiguration(settings).then((result) => {
      if (cancelled) return;
      setTestResult(result);
      if (result.ok) saveSettings(settings);
      setPhase("result");
    });

    return () => {
      cancelled = true;
    };
  }, [phase, authMethod, values, oauthResult]);

  useInput((input, key) => {
    if (phase === "authSelect") {
      if (key.upArrow) {
        setSelectedAuthIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedAuthIndex((current) => Math.min(AUTH_OPTIONS.length - 1, current + 1));
        return;
      }
      if (key.return) {
        const selected = AUTH_OPTIONS[selectedAuthIndex]!;
        const method = selected.key;
        setAuthMethod(method);
        setStepIndex(0);
        setTestResult(null);

        if (method === "api") {
          const firstStep = getStepsForState(method, values)[0]!;
          setCurrentInput(values[firstStep.key] || firstStep.defaultValue);
          setPhase("input");
        } else {
          setAuthMessage("Starting ChatGPT authentication...");
          setPhase("authenticating");
        }
        return;
      }
      if (key.escape) {
        exit();
      }
      return;
    }

    if (phase === "confirm") {
      if (input === "y" || input === "Y" || key.return) {
        if (!authMethod) return;
        setPhase("testing");
      } else if (input === "n" || input === "N") {
        setStepIndex(0);
        setCurrentInput(steps[0] ? values[steps[0].key] || steps[0].defaultValue : "");
        setPhase("input");
      } else if (key.escape) {
        exit();
      }
      return;
    }

    if (phase === "result") {
      if (testResult?.ok) {
        exit();
        return;
      }

      if (input === "r" || input === "R") {
        setPhase("authSelect");
        setAuthMethod(null);
        setCurrentInput("");
        setTestResult(null);
        return;
      }

      if (input === "s" || input === "S") {
        if (authMethod) {
          try {
            saveSettings(buildSettings(authMethod, values, oauthResult));
          } catch {}
        }
        exit();
        return;
      }

      if (input === "q" || input === "Q" || key.escape) {
        exit();
      }
    }
  });

  const handleSubmit = (value: string) => {
    if (!step) return;

    const finalValue =
      step.key === "embeddingProvider"
        ? normalizeEmbeddingProvider(value.trim().toLowerCase())
        : value || step.defaultValue;
    const nextValues = { ...values, [step.key]: finalValue };

    if (step.key === "embeddingProvider") {
      const provider = normalizeEmbeddingProvider(finalValue);
      nextValues.embeddingBaseURL = getDefaultEmbeddingBaseURL(provider);
      nextValues.embeddingModel = getDefaultEmbeddingModel(provider);
      if (provider === "local") {
        nextValues.embeddingApiKey = "";
      }
    }

    setValues(nextValues);

    const nextSteps = getStepsForState(authMethod, nextValues);
    if (stepIndex < nextSteps.length - 1) {
      const nextStep = nextSteps[stepIndex + 1]!;
      setStepIndex(stepIndex + 1);
      setCurrentInput(nextValues[nextStep.key] || nextStep.defaultValue);
      return;
    }

    setPhase("confirm");
  };

  const selectedOption = AUTH_OPTIONS[selectedAuthIndex];
  const embeddingProvider = normalizeEmbeddingProvider(values.embeddingProvider);

  if (phase === "authSelect") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="magenta" paddingX={2} marginBottom={1}>
          <Text color="magenta" bold>Mnemonic Setup</Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">Select auth method</Text>
          <Text dimColor>Use arrow keys and press Enter.</Text>
        </Box>
        <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
          {AUTH_OPTIONS.map((option, index) => (
            <Box
              key={option.key}
              flexDirection="column"
              marginBottom={index === AUTH_OPTIONS.length - 1 ? 0 : 1}
            >
              <Text color={index === selectedAuthIndex ? "yellow" : "white"}>
                {index === selectedAuthIndex ? "❯" : " "} {option.label}
              </Text>
              <Text dimColor>{option.hint}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Current selection: {selectedOption?.label}</Text>
        </Box>
      </Box>
    );
  }

  if (phase === "authenticating") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="magenta" paddingX={2} marginBottom={1}>
          <Text color="magenta" bold>Mnemonic Setup</Text>
        </Box>
        <Text color="yellow">Authenticating with ChatGPT...</Text>
        <Box marginTop={1} flexDirection="column">
          {authMessage.split("\n").map((line, index) => (
            <Text key={`${line}-${index}`} dimColor={index !== 0}>
              {line}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to quit if you want to cancel and restart.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === "testing") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="magenta" paddingX={2} marginBottom={1}>
          <Text color="magenta" bold>Mnemonic Setup</Text>
        </Box>
        <Text color="yellow">Testing chat and embedding configuration...</Text>
        <Box marginTop={1}>
          <Text dimColor>Chat model: {values.model}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Embedding provider: {embeddingProvider}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Embedding model: {values.embeddingModel || getDefaultEmbeddingModel(embeddingProvider)}
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase === "result" && testResult) {
    if (testResult.ok) {
      return (
        <Box flexDirection="column" padding={1}>
          <Box borderStyle="round" borderColor="green" paddingX={2} marginBottom={1}>
            <Text color="green" bold>Mnemonic Setup</Text>
          </Box>
          <Text color="green" bold>Connection and configuration saved.</Text>
          <Text dimColor>Settings file: global Mnemonic config</Text>
          {authMethod !== "api" && <Text color="yellow">OAuth chat is ready.</Text>}
          <Text color="cyan">Embedding configuration is ready.</Text>
          <Box marginTop={1}>
            <Text dimColor>Run </Text>
            <Text bold>bun run start</Text>
            <Text dimColor> to launch the agent.</Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="red" paddingX={2} marginBottom={1}>
          <Text color="red" bold>Mnemonic Setup</Text>
        </Box>
        <Text color="red" bold>Configuration failed</Text>
        <Box marginTop={1}>
          <Text dimColor>Error: </Text>
          <Text color="red">{testResult.error}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold color="yellow">R</Text>
            <Text dimColor> — Restart setup</Text>
          </Text>
          <Text>
            <Text bold color="yellow">S</Text>
            <Text dimColor> — Save anyway</Text>
          </Text>
          <Text>
            <Text bold color="yellow">Q</Text>
            <Text dimColor> — Quit</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="magenta" paddingX={2} marginBottom={1}>
        <Text color="magenta" bold>Mnemonic Setup</Text>
      </Box>

      <Box marginBottom={1}>
        {steps.map((item, index) => (
          <Box key={item.key} marginRight={1}>
            <Text color={index < stepIndex ? "green" : index === stepIndex ? "yellow" : "grey"}>
              {index < stepIndex ? "✓" : index === stepIndex ? "→" : "○"} {item.label}
            </Text>
          </Box>
        ))}
      </Box>

      {phase === "input" && step && (
        <Box flexDirection="column">
          <Text bold color="cyan">
            [{stepIndex + 1}/{steps.length}] {step.label}
          </Text>
          {step.hint && (
            <Box marginTop={1}>
              <Text dimColor>{step.hint}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              Default: {step.masked && step.defaultValue ? "••••••" : step.defaultValue || "(empty)"}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="yellow">❯ </Text>
            <TextInput
              value={currentInput}
              onChange={setCurrentInput}
              onSubmit={handleSubmit}
              mask={step.masked ? "*" : undefined}
              placeholder={step.optional ? "Leave empty to skip" : step.defaultValue || "Enter value..."}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Press Enter to confirm
              {step.optional ? " (empty = skip)" : step.defaultValue ? " (empty = use default)" : ""}
            </Text>
          </Box>
        </Box>
      )}

      {phase === "confirm" && authMethod && (
        <Box flexDirection="column">
          <Box
            borderStyle="single"
            borderColor="cyan"
            flexDirection="column"
            paddingX={2}
            paddingY={1}
            marginBottom={1}
          >
            <Text bold underline color="cyan">
              Configuration Summary
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Box>
                <Text dimColor>Auth Mode:   </Text>
                <Text>{AUTH_OPTIONS.find((option) => option.key === authMethod)?.label}</Text>
              </Box>
              {authMethod === "api" ? (
                <>
                  <Box>
                    <Text dimColor>API Key:     </Text>
                    <Text>{values.apiKey ? `${values.apiKey.slice(0, 8)}••••••••` : "(empty)"}</Text>
                  </Box>
                  <Box>
                    <Text dimColor>Base URL:    </Text>
                    <Text>{values.baseURL}</Text>
                  </Box>
                </>
              ) : (
                <Box>
                  <Text dimColor>Account ID:  </Text>
                  <Text>{oauthResult?.accountId ?? "(not provided)"}</Text>
                </Box>
              )}
              <Box>
                <Text dimColor>Model:       </Text>
                <Text>{values.model}</Text>
              </Box>
              <Box>
                <Text dimColor>Embedding:   </Text>
                <Text>{embeddingProvider}</Text>
              </Box>
              {embeddingProvider !== "local" && (
                <Box>
                  <Text dimColor>Embed Key:   </Text>
                  <Text>
                    {values.embeddingApiKey ? `${values.embeddingApiKey.slice(0, 8)}••••••••` : "(empty)"}
                  </Text>
                </Box>
              )}
              <Box>
                <Text dimColor>Embed URL:   </Text>
                <Text>{values.embeddingBaseURL}</Text>
              </Box>
              <Box>
                <Text dimColor>Embed Model: </Text>
                <Text>{values.embeddingModel}</Text>
              </Box>
            </Box>
          </Box>
          <Text bold color="yellow">
            Save and test configuration? <Text dimColor>[Y/n]</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function runSetup() {
  prepareRuntime();
  render(<Setup />);
}

if (import.meta.main) {
  runSetup();
}
