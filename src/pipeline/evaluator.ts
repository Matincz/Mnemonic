import type { ParsedSession } from "../types";
import { llmGenerateJSON } from "../llm";
import { evaluatePrompt } from "../llm/prompts";
import { EvalResultSchema } from "../llm/schemas";

export async function evaluate(session: ParsedSession): Promise<{
  shouldProcess: boolean;
  reason: string;
}> {
  const heuristicSkip = classifyObviousNonMemorySession(session);
  if (heuristicSkip) {
    return { shouldProcess: false, reason: heuristicSkip };
  }

  // Quick heuristic: skip very short sessions
  if (session.messages.length < 2) {
    return { shouldProcess: false, reason: "Too few messages" };
  }

  // Skip sessions with only trivial content
  const totalChars = session.messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars < 100) {
    return { shouldProcess: false, reason: "Content too short" };
  }

  const result = await llmGenerateJSON(evaluatePrompt(session), EvalResultSchema);
  return {
    shouldProcess: result.worth_remembering,
    reason: result.reason,
  };
}

function classifyObviousNonMemorySession(session: ParsedSession): string | null {
  const normalizedMessages = session.messages
    .map((message) => normalizeText(message.content))
    .filter(Boolean);

  if (normalizedMessages.length === 0) {
    return "No substantive session content was provided beyond metadata or empty messages.";
  }

  const joined = normalizedMessages.join("\n");
  const totalChars = joined.length;

  if (normalizedMessages.every((message) => message.length <= 3)) {
    return "Only trivial one-word or short-token messages were provided, with no durable engineering content.";
  }

  if (isSingleTurnClarificationSession(session, normalizedMessages)) {
    return "Single short interaction with a greeting, vague request, or clarification prompt, but no durable project-specific fact, decision, bug, fix, or reusable pattern.";
  }

  if (isPureJsonClassificationPrompt(joined)) {
    return "The transcript contains only a meta-instruction to respond with JSON and no substantive project-specific facts, decisions, bugs, fixes, or reusable procedures.";
  }

  if (isSandboxOrPolicyOnlySession(joined) && totalChars < 20000) {
    return "This session only contains sandbox/approval instructions and environment setup details, with no project-specific decision, bug, fix, or reusable engineering insight to retain long-term.";
  }

  if (isRepeatedAutomationNoise(joined) && totalChars < 12000) {
    return "This session looks like a repeated automation or sync success log without a new failure, decision, fix, or reusable lesson.";
  }

  if (isEnvironmentSnapshotOnly(joined) && totalChars < 4000) {
    return "This session is mainly environment snapshot metadata (cwd, shell, timezone, env vars) without a durable engineering takeaway.";
  }

  if (isBenignTelemetryOnly(joined) && totalChars < 4000) {
    return "This session contains a one-off telemetry or sensor reading without an anomaly, regression, or durable lesson.";
  }

  if (isVersionCheckOrModelInfo(joined) && totalChars < 4000) {
    return "This session only checks a tool version or lists model/session metadata without a decision, fix, or reusable lesson.";
  }

  return null;
}

function normalizeText(value: string | undefined | null) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function isPureJsonClassificationPrompt(text: string) {
  const lower = text.toLowerCase();
  const markers = [
    "return json only",
    "respond with json only",
    "you must respond with json only",
    "generate metadata for a coding agent",
    "\"title\"",
    "json schema",
    "worth_remembering",
    "estimated_layers",
  ];

  const markerHits = markers.filter((marker) => lower.includes(marker)).length;
  const negativeMarkers = [
    "error",
    "fix",
    "stack trace",
    "diff",
    "patch",
    "failed",
    "exception",
    "bug",
    "implement",
    "refactor",
  ];

  const hasNegative = negativeMarkers.some((marker) => lower.includes(marker));
  return markerHits >= 3 && !hasNegative;
}

function isSandboxOrPolicyOnlySession(text: string) {
  const lower = text.toLowerCase();
  const markers = [
    "sandbox",
    "approval",
    "workspace-write",
    "danger-full-access",
    "collaboration mode",
    "developer instructions",
    "environment_context",
    "ag ents.md".replace(" ", ""),
    "you are codex",
    "formatting rules",
    "final answer instructions",
  ];
  const markerHits = markers.filter((marker) => lower.includes(marker)).length;
  const contentSignals = [
    "src/",
    "tests/",
    ".ts",
    ".tsx",
    ".js",
    ".py",
    "fatal:",
    "traceback",
    "error:",
    "exception",
    "failed",
  ];
  const hasContentSignal = contentSignals.some((signal) => lower.includes(signal));

  return markerHits >= 4 && !hasContentSignal;
}

function isSingleTurnClarificationSession(session: ParsedSession, normalizedMessages: string[]) {
  if (session.messages.length > 4 || normalizedMessages.length > 4) {
    return false;
  }

  const lowerMessages = normalizedMessages.map((message) => message.toLowerCase());
  const greetingLike = lowerMessages.some((message) =>
    ["你好", "hello", "hi", "hey", "what's up"].some((token) => containsPhrase(message, token)),
  );
  const clarificationLike = lowerMessages.some((message) =>
    [
      "what would you like me to do",
      "how can i help",
      "有什么要处理的",
      "what do you want",
      "i only got",
    ].some((token) => containsPhrase(message, token)),
  );
  const veryShort = lowerMessages.every((message) => message.length < 120);
  const technicalSignal = lowerMessages.some((message) =>
    ["error", "fix", "stack", "build", "test", "deploy", "config", "bug", "trace", "code"].some((token) =>
      message.includes(token),
    ),
  );

  return veryShort && (greetingLike || clarificationLike) && !technicalSignal;
}

function containsPhrase(text: string, phrase: string) {
  if (/[\u4e00-\u9fff]/.test(phrase)) {
    return text.includes(phrase);
  }

  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(text);
}

function isRepeatedAutomationNoise(text: string) {
  const lower = text.toLowerCase();
  const automationMarkers = ["cron", "sync", "heartbeat", "scheduled run", "routine run", "job completed"];
  const successMarkers = ["completed successfully", "success", "succeeded", "pushed data", "finished normally"];
  const noveltyMarkers = [
    "error",
    "failed",
    "fix",
    "regression",
    "anomaly",
    "incident",
    "threshold",
    "decision",
    "changed",
    "updated",
  ];

  const automationHit = automationMarkers.some((marker) => lower.includes(marker));
  const successHit = successMarkers.some((marker) => lower.includes(marker));
  const noveltyHit = noveltyMarkers.some((marker) => lower.includes(marker));

  return automationHit && successHit && !noveltyHit;
}

function isEnvironmentSnapshotOnly(text: string) {
  const lower = text.toLowerCase();
  const markers = ["cwd:", "shell:", "timezone:", "path=", "home=", "user=", "pwd:", "workspace-write"];
  const markerHits = markers.filter((marker) => lower.includes(marker)).length;
  const durableSignals = [
    "error",
    "failed",
    "fix",
    "config change",
    "deploy",
    "build failed",
    "build fix",
    "test failed",
    "test pass",
    "migration",
    "decision",
  ];

  return markerHits >= 3 && !durableSignals.some((signal) => containsPhrase(lower, signal));
}

function isBenignTelemetryOnly(text: string) {
  const lower = text.toLowerCase();
  const telemetryMarkers = ["sensor", "reading", "telemetry", "pressure", "temperature", "voltage", "battery"];
  const anomalyMarkers = ["anomaly", "abnormal", "spike", "drift", "alert", "failure", "regression", "exceeded"];
  const telemetryHits = telemetryMarkers.filter((marker) => lower.includes(marker)).length;

  return telemetryHits >= 2 && !anomalyMarkers.some((marker) => lower.includes(marker));
}

function isVersionCheckOrModelInfo(text: string) {
  const lower = text.toLowerCase();
  const versionMarkers = [
    "version check",
    "installed version",
    "current version",
    "model configuration",
    "session model",
    "mapped to",
    "using model",
  ];
  const durableMarkers = [
    "upgrade",
    "migration",
    "breaking change",
    "deprecated",
    "incompatible",
    "decision",
    "switched to",
    "replaced",
  ];

  const versionHits = versionMarkers.filter((marker) => lower.includes(marker)).length;
  return versionHits >= 1 && !durableMarkers.some((marker) => lower.includes(marker));
}
