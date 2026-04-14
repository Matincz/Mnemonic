import React, { useEffect, useMemo, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  authenticateWithOpenAIBrowser,
  authenticateWithOpenAIHeadless,
  type OAuthLoginResult,
} from "../llm/openai-auth";
import { prepareRuntime } from "../migration";
import { loadSettings, saveSettings, type ApiSettings, type OAuthSettings, type Settings } from "../settings";

type AuthMethod = "oauth-browser" | "oauth-headless" | "api";
type FieldKey = "apiKey" | "baseURL" | "model" | "embeddingModel";
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
  { key: "embeddingModel", label: "Embedding Model", defaultValue: "text-embedding-3-small", masked: false },
];

const OAUTH_STEPS: StepConfig[] = [
  { key: "model", label: "Chat Model", defaultValue: "gpt-5.4-mini", masked: false },
  { key: "embeddingModel", label: "Embedding Model", defaultValue: "text-embedding-3-small", masked: false },
  {
    key: "apiKey",
    label: "Embedding API Key",
    defaultValue: "",
    masked: true,
    optional: true,
    hint: "Optional. Needed if you want OpenAI embeddings.",
  },
  {
    key: "baseURL",
    label: "Embedding Base URL",
    defaultValue: "https://api.openai.com/v1",
    masked: false,
    optional: true,
    hint: "Optional. Used with the embedding API key.",
  },
];

type FormValues = Record<FieldKey, string>;

function getInitialValues(existing: Settings | null): FormValues {
  if (existing?.authMode === "api") {
    return {
      apiKey: existing.apiKey,
      baseURL: existing.baseURL,
      model: existing.model,
      embeddingModel: existing.embeddingModel,
    };
  }

  if (existing?.authMode === "oauth") {
    return {
      apiKey: existing.apiKey ?? "",
      baseURL: existing.baseURL ?? "https://api.openai.com/v1",
      model: existing.model,
      embeddingModel: existing.embeddingModel,
    };
  }

  return {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    embeddingModel: "text-embedding-3-small",
  };
}

function buildSettings(
  method: AuthMethod,
  values: FormValues,
  oauth: OAuthLoginResult | null,
): Settings {
  if (method === "api") {
    const settings: ApiSettings = {
      authMode: "api",
      apiKey: values.apiKey,
      baseURL: values.baseURL || "https://api.openai.com/v1",
      model: values.model || "gpt-4.1-mini",
      embeddingModel: values.embeddingModel || "text-embedding-3-small",
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
    embeddingModel: values.embeddingModel || "text-embedding-3-small",
    apiKey: values.apiKey || undefined,
    baseURL: values.baseURL || "https://api.openai.com/v1",
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

  const steps = useMemo(() => {
    if (authMethod === "api") return API_STEPS;
    if (authMethod === "oauth-browser" || authMethod === "oauth-headless") return OAUTH_STEPS;
    return [];
  }, [authMethod]);

  const step = steps[stepIndex];

  useEffect(() => {
    if (phase !== "authenticating" || !authMethod) return;

    let cancelled = false;

    (async () => {
      try {
        const oauth =
          authMethod === "oauth-browser"
            ? await authenticateWithOpenAIBrowser((url) => {
                if (!cancelled) setAuthMessage(`Open this URL in your browser if it did not launch automatically:\n${url}`);
              })
            : await authenticateWithOpenAIHeadless((prompt) => {
                if (!cancelled) {
                  setAuthMessage(`Visit ${prompt.verificationUrl}\nEnter code: ${prompt.userCode}`);
                }
              });

        if (cancelled) return;
        setOAuthResult(oauth);
        setStepIndex(0);
        setCurrentInput(values[OAUTH_STEPS[0].key] || OAUTH_STEPS[0].defaultValue);
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
  }, [phase, authMethod]);

  useEffect(() => {
    if (phase !== "testing" || authMethod !== "api") return;
    let cancelled = false;

    const settings = buildSettings("api", values, null) as ApiSettings;
    testApiConnection(settings).then((result) => {
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
          setCurrentInput(values[API_STEPS[0].key] || API_STEPS[0].defaultValue);
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
        if (authMethod === "api") {
          setPhase("testing");
          return;
        }
        try {
          saveSettings(buildSettings(authMethod, values, oauthResult));
          setTestResult({ ok: true });
          setPhase("result");
        } catch (err: any) {
          setTestResult({ ok: false, error: err?.message ?? String(err) });
          setPhase("result");
        }
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
    const finalValue = value || step.defaultValue;
    const nextValues = { ...values, [step.key]: finalValue };
    setValues(nextValues);

    if (stepIndex < steps.length - 1) {
      const nextStep = steps[stepIndex + 1]!;
      setStepIndex(stepIndex + 1);
      setCurrentInput(nextValues[nextStep.key] || nextStep.defaultValue);
      return;
    }

    setPhase("confirm");
  };

  const selectedOption = AUTH_OPTIONS[selectedAuthIndex];

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
            <Box key={option.key} flexDirection="column" marginBottom={index === AUTH_OPTIONS.length - 1 ? 0 : 1}>
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
            <Text key={`${line}-${index}`} dimColor={index === 0 ? false : true}>
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
        <Text color="yellow">Testing API key connection...</Text>
        <Box marginTop={1}>
          <Text dimColor>Model: {values.model}</Text>
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
          {authMethod !== "api" && !values.apiKey && (
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow">OAuth chat is ready.</Text>
              <Text dimColor>No embedding API key was configured. Embedding calls will fail until you add one.</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Run </Text><Text bold>bun run start</Text><Text dimColor> to launch the agent.</Text>
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
          <Text dimColor>Error: </Text><Text color="red">{testResult.error}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text><Text bold color="yellow">R</Text><Text dimColor> — Restart setup</Text></Text>
          <Text><Text bold color="yellow">S</Text><Text dimColor> — Save anyway</Text></Text>
          <Text><Text bold color="yellow">Q</Text><Text dimColor> — Quit</Text></Text>
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
          <Box borderStyle="single" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1} marginBottom={1}>
            <Text bold underline color="cyan">Configuration Summary</Text>
            <Box marginTop={1} flexDirection="column">
              <Box><Text dimColor>Auth Mode:   </Text><Text>{AUTH_OPTIONS.find((option) => option.key === authMethod)?.label}</Text></Box>
              {authMethod === "api" ? (
                <>
                  <Box><Text dimColor>API Key:     </Text><Text>{values.apiKey ? `${values.apiKey.slice(0, 8)}••••••••` : "(empty)"}</Text></Box>
                  <Box><Text dimColor>Base URL:    </Text><Text>{values.baseURL}</Text></Box>
                </>
              ) : (
                <>
                  <Box><Text dimColor>Account ID:  </Text><Text>{oauthResult?.accountId ?? "(not provided)"}</Text></Box>
                  <Box><Text dimColor>Embed Key:   </Text><Text>{values.apiKey ? `${values.apiKey.slice(0, 8)}••••••••` : "(not configured)"}</Text></Box>
                  <Box><Text dimColor>Embed URL:   </Text><Text>{values.baseURL || "(default)"}</Text></Box>
                </>
              )}
              <Box><Text dimColor>Model:       </Text><Text>{values.model}</Text></Box>
              <Box><Text dimColor>Embedding:   </Text><Text>{values.embeddingModel}</Text></Box>
            </Box>
          </Box>
          <Text bold color="yellow">
            {authMethod === "api" ? "Save and test API connection?" : "Save configuration?"} <Text dimColor>[Y/n]</Text>
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
