import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { getAppPaths } from "./app-paths";
import { prepareRuntime } from "./migration";
import { loadSettings, removeSettings, saveSettings, type ApiSettings, type OAuthSettings } from "./settings";
import { authenticateWithOpenAIBrowser, authenticateWithOpenAIHeadless } from "./llm/openai-auth";
import { runDaemon } from "./index";
import { runTui } from "./tui/index";
import { runSetup } from "./tui/setup";

export type ParsedCliCommand =
  | { name: "start" }
  | { name: "tui" }
  | { name: "setup" }
  | { name: "paths" }
  | { name: "doctor" }
  | { name: "auth-status" }
  | { name: "auth-list" }
  | { name: "auth-openai-browser" }
  | { name: "auth-openai-headless" }
  | { name: "auth-openai-api-key" }
  | { name: "auth-logout-openai" }
  | { name: "help" };

export function parseCliArgs(args: string[]): ParsedCliCommand {
  const [head, second, third] = args;

  if (!head) return { name: "help" };
  if (head === "start") return { name: "start" };
  if (head === "tui") return { name: "tui" };
  if (head === "setup") return { name: "setup" };
  if (head === "paths") return { name: "paths" };
  if (head === "doctor") return { name: "doctor" };
  if (head === "auth" && second === "status") return { name: "auth-status" };
  if (head === "auth" && second === "list") return { name: "auth-list" };
  if (head === "auth" && second === "openai" && third === "browser") return { name: "auth-openai-browser" };
  if (head === "auth" && second === "openai" && third === "headless") return { name: "auth-openai-headless" };
  if (head === "auth" && second === "openai" && third === "api-key") return { name: "auth-openai-api-key" };
  if (head === "auth" && second === "logout" && third === "openai") return { name: "auth-logout-openai" };

  return { name: "help" };
}

function printHelp() {
  console.log(`Mnemonic

Usage:
  mnemonic start
  mnemonic tui
  mnemonic setup
  mnemonic paths
  mnemonic doctor
  mnemonic auth status
  mnemonic auth list
  mnemonic auth openai browser
  mnemonic auth openai headless
  mnemonic auth openai api-key
  mnemonic auth logout openai`);
}

function printPaths() {
  const paths = getAppPaths();
  console.log(`Mnemonic paths
dataRoot: ${paths.dataRoot}
configRoot: ${paths.configRoot}
dataDir: ${paths.dataDir}
vaultPath: ${paths.vaultPath}
sqlitePath: ${paths.sqlitePath}
lanceDir: ${paths.lanceDir}
settingsPath: ${paths.settingsPath}
legacyRoot: ${paths.legacyRoot}`);
}

function printDoctor() {
  const paths = getAppPaths();
  const settings = loadSettings();
  console.log(`Mnemonic doctor
settingsPath: ${paths.settingsPath}
sqlitePath: ${paths.sqlitePath}
authConfigured: ${settings ? "yes" : "no"}
authMode: ${settings?.authMode ?? "none"}`);
  const migration = prepareRuntime();
  console.log(`migration: ${migration.reason}`);
}

function printAuthStatus() {
  const settings = loadSettings();
  if (!settings) {
    console.log("No auth configured.");
    return;
  }

  if (settings.authMode === "api") {
    console.log(`openai: apiKey
baseURL: ${settings.baseURL}
model: ${settings.model}
embeddingModel: ${settings.embeddingModel}`);
    return;
  }

  console.log(`openai: oauth
accountId: ${settings.accountId ?? "(none)"}
expiresAt: ${new Date(settings.expiresAt).toISOString()}
model: ${settings.model}
embeddingModel: ${settings.embeddingModel}
embeddingApiKeyConfigured: ${settings.apiKey ? "yes" : "no"}`);
}

function printAuthList() {
  const settings = loadSettings();
  if (!settings) {
    console.log("No providers configured.");
    return;
  }
  console.log(`openai (${settings.authMode})`);
}

async function prompt(question: string, masked = false): Promise<string> {
  const rl = createInterface({ input, output });
  if (!masked) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }
  rl.close();
  process.stdout.write(question);
  const chunks: string[] = [];
  return await new Promise((resolve) => {
    const onData = (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      if (text === "\r" || text === "\n") {
        process.stdin.off("data", onData);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(chunks.join("").trim());
        return;
      }
      if (text === "\u0003") process.exit(1);
      if (text === "\u007f") {
        chunks.pop();
        return;
      }
      chunks.push(text);
    };

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function configureApiKeyAuth() {
  const existing = loadSettings();
  const apiKey = await prompt("OpenAI API key: ", true);
  const baseURL =
    (await prompt(`Base URL [${existing?.authMode === "api" ? existing.baseURL : "https://api.openai.com/v1"}]: `)) ||
    (existing?.authMode === "api" ? existing.baseURL : "https://api.openai.com/v1");
  const model =
    (await prompt(`Chat model [${existing?.model ?? "gpt-4.1-mini"}]: `)) || existing?.model || "gpt-4.1-mini";
  const embeddingModel =
    (await prompt(`Embedding model [${existing?.embeddingModel ?? "text-embedding-3-small"}]: `)) ||
    existing?.embeddingModel ||
    "text-embedding-3-small";

  const settings: ApiSettings = {
    authMode: "api",
    apiKey,
    baseURL,
    model,
    embeddingModel,
  };

  saveSettings(settings);
  console.log("Saved OpenAI API key auth.");
}

async function configureOAuthAuth(mode: "browser" | "headless") {
  const existing = loadSettings();
  const oauth =
    mode === "browser"
      ? await authenticateWithOpenAIBrowser((url) => {
          console.log(`Open this URL if your browser did not launch:\n${url}`);
        })
      : await authenticateWithOpenAIHeadless((promptInfo) => {
          console.log(`Visit ${promptInfo.verificationUrl}`);
          console.log(`Enter code: ${promptInfo.userCode}`);
        });

  const model =
    (await prompt(`Chat model [${existing?.model ?? "gpt-5.4-mini"}]: `)) || existing?.model || "gpt-5.4-mini";
  const embeddingModel =
    (await prompt(`Embedding model [${existing?.embeddingModel ?? "text-embedding-3-small"}]: `)) ||
    existing?.embeddingModel ||
    "text-embedding-3-small";
  const apiKey = await prompt("Embedding API key (optional): ", true);
  const baseURL = (await prompt(`Embedding base URL [https://api.openai.com/v1]: `)) || "https://api.openai.com/v1";

  const settings: OAuthSettings = {
    authMode: "oauth",
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    accountId: oauth.accountId,
    model,
    embeddingModel,
    apiKey: apiKey || undefined,
    baseURL,
  };

  saveSettings(settings);
  console.log("Saved OpenAI OAuth auth.");
}

function logoutOpenAI() {
  const settings = loadSettings();
  if (!settings) {
    console.log("No auth configured.");
    return;
  }
  removeSettings();
  console.log("Removed OpenAI auth.");
}

export async function runCli(args = process.argv.slice(2)) {
  const migration = prepareRuntime();
  if (migration.migrated) {
    console.log(`Migrated legacy data from ${getAppPaths().legacyRoot}`);
  } else if (migration.reason === "target-not-empty") {
    console.log("Legacy data detected, but the new Mnemonic directories already contain data. Skipping migration.");
  }

  const command = parseCliArgs(args);

  switch (command.name) {
    case "start":
      await runDaemon();
      return;
    case "tui":
      runTui();
      return;
    case "setup":
      runSetup();
      return;
    case "paths":
      printPaths();
      return;
    case "doctor":
      printDoctor();
      return;
    case "auth-status":
      printAuthStatus();
      return;
    case "auth-list":
      printAuthList();
      return;
    case "auth-openai-browser":
      await configureOAuthAuth("browser");
      return;
    case "auth-openai-headless":
      await configureOAuthAuth("headless");
      return;
    case "auth-openai-api-key":
      await configureApiKeyAuth();
      return;
    case "auth-logout-openai":
      logoutOpenAI();
      return;
    case "help":
    default:
      printHelp();
  }
}

if (import.meta.main) {
  runCli().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
