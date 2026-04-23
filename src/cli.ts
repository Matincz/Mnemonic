import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAppPaths, resolveAppPaths } from "./app-paths";
import { createApp } from "./app";
import { prepareRuntime } from "./migration";
import {
  invalidateEmbeddingCache,
} from "./embeddings";
import {
  loadSettings,
  removeSettings,
  saveSettings,
  type ApiSettings,
  type EmbeddingSettings,
  type OAuthSettings,
} from "./settings";
import { authenticateWithOpenAIBrowser, authenticateWithOpenAIHeadless } from "./llm/openai-auth";
import { runDaemon } from "./index";
import { runTui } from "./tui/index";
import { runSetup } from "./tui/setup";
import { Storage } from "./storage";
import { RuntimeIPC } from "./ipc/runtime";
import { WikiEngine } from "./wiki/engine";
import { IndexManager } from "./wiki/index-manager";
import { WikiQuery } from "./wiki/query";
import { llmGenerate } from "./llm";
import { combinedQueryPrompt } from "./llm/prompts";
import { renderMemoryGraph, type GraphFormat } from "./graph";
import { WatcherOrchestrator } from "./watcher";
import { repairWikiLinks } from "./wiki/repair";

export type ParsedCliCommand =
  | { name: "start" }
  | { name: "tui" }
  | { name: "setup" }
  | { name: "paths" }
  | { name: "status" }
  | { name: "stats" }
  | { name: "backfill"; reset: boolean }
  | { name: "reset-data" }
  | { name: "reindex" }
  | { name: "optimize" }
  | { name: "repair-wikilinks"; write: boolean }
  | { name: "export"; format: "json" | "markdown"; outputPath?: string }
  | { name: "graph"; format: GraphFormat; outputPath?: string }
  | { name: "search"; query: string }
  | { name: "query"; question: string }
  | { name: "prune"; dryRun: boolean }
  | { name: "doctor" }
  | { name: "auth-status" }
  | { name: "auth-list" }
  | { name: "auth-openai-browser" }
  | { name: "auth-openai-headless" }
  | { name: "auth-openai-api-key" }
  | { name: "auth-logout-openai" }
  | { name: "unknown"; input: string }
  | { name: "help" };

export function parseCliArgs(args: string[]): ParsedCliCommand {
  const [head, second, third, ...rest] = args;
  const tail = [second, third, ...rest].filter(Boolean).join(" ").trim();

  if (!head) return { name: "help" };
  if (head === "help") return { name: "help" };
  if (head === "start") return { name: "start" };
  if (head === "tui") return { name: "tui" };
  if (head === "setup") return { name: "setup" };
  if (head === "paths") return { name: "paths" };
  if (head === "status") return { name: "status" };
  if (head === "stats") return { name: "stats" };
  if (head === "backfill") return { name: "backfill", reset: args.includes("--reset") };
  if (head === "reset-data") return { name: "reset-data" };
  if (head === "reindex") return { name: "reindex" };
  if (head === "optimize") return { name: "optimize" };
  if (head === "repair-wikilinks") return { name: "repair-wikilinks", write: args.includes("--write") };
  if (head === "export" && (second === "json" || second === "markdown")) {
    return {
      name: "export",
      format: second,
      outputPath: [third, ...rest].filter(Boolean).join(" ").trim() || undefined,
    };
  }
  if (head === "graph" && (!second || second === "mermaid" || second === "dot" || second === "json")) {
    return {
      name: "graph",
      format: (second as GraphFormat | undefined) ?? "mermaid",
      outputPath: second ? [third, ...rest].filter(Boolean).join(" ").trim() || undefined : undefined,
    };
  }
  if (head === "search" && tail) return { name: "search", query: tail };
  if (head === "query" && tail) return { name: "query", question: tail };
  if (head === "prune") return { name: "prune", dryRun: args.includes("--dry-run") };
  if (head === "doctor") return { name: "doctor" };
  if (head === "auth" && second === "status") return { name: "auth-status" };
  if (head === "auth" && second === "list") return { name: "auth-list" };
  if (head === "auth" && second === "openai" && third === "browser") return { name: "auth-openai-browser" };
  if (head === "auth" && second === "openai" && third === "headless") return { name: "auth-openai-headless" };
  if (head === "auth" && second === "openai" && third === "api-key") return { name: "auth-openai-api-key" };
  if (head === "auth" && second === "logout" && third === "openai") return { name: "auth-logout-openai" };

  return { name: "unknown", input: args.join(" ").trim() };
}

function printHelp() {
  console.log(`Mnemonic

Usage:
  mnemonic start                  Start the background daemon
  mnemonic tui                    Launch the interactive terminal UI
  mnemonic setup                  Run the first-time setup wizard
  mnemonic paths                  Show all data and config file paths
  mnemonic status                 Show daemon and memory store status
  mnemonic stats                  Show memory statistics by layer/project/agent
  mnemonic backfill [--reset]     Re-process all watched sessions (--reset clears first)
  mnemonic reset-data             Delete all generated data while keeping configured auth/model settings
  mnemonic reindex                Rebuild the vector embedding index
  mnemonic optimize               Run maintenance sweep and optimize vector storage
  mnemonic prune [--dry-run]      Remove low-quality memories (low salience episodic, short content)
  mnemonic repair-wikilinks       Scan wiki links and optionally rewrite safe aliases
  mnemonic export <json|markdown> Export all memories to a file
  mnemonic graph [fmt] [out]       Export memory relation graph (mermaid/dot/json)
  mnemonic search <query>         Search memories by text and embeddings
  mnemonic query <question>       Ask a natural-language question
  mnemonic doctor                 Check system health and configuration
  mnemonic auth status            Show current authentication info
  mnemonic auth list              List configured auth providers
  mnemonic auth openai browser    Log in via browser OAuth
  mnemonic auth openai headless   Log in via device code flow
  mnemonic auth openai api-key    Configure an API key
  mnemonic auth logout openai     Remove OpenAI credentials`);
}

function printPaths() {
  const paths = getAppPaths();
  console.log(`Mnemonic paths
dataRoot: ${paths.dataRoot}
configRoot: ${paths.configRoot}
dataDir: ${paths.dataDir}
lanceDir: ${paths.lanceDir}
vaultPath: ${paths.vaultPath}
sqlitePath: ${paths.sqlitePath}
settingsPath: ${paths.settingsPath}
ipcStatusPath: ${paths.ipcStatusPath}
ipcEventsPath: ${paths.ipcEventsPath}
legacyRoot: ${paths.legacyRoot}`);
}

async function printDoctor() {
  const paths = getAppPaths();
  const settings = loadSettings();
  const { storage } = createApp();
  await storage.init();
  const stats = await storage.stats();
  console.log(`Mnemonic doctor
settingsPath: ${paths.settingsPath}
sqlitePath: ${paths.sqlitePath}
lanceDir: ${paths.lanceDir}
authConfigured: ${settings ? "yes" : "no"}
authMode: ${settings?.authMode ?? "none"}
vectorBackend: ${stats.vector.backend}
vectorIndexed: ${stats.vector.indexed}
vectorIndices: ${stats.vector.indices.map((index) => index.name).join(", ") || "(none)"}`);
  const migration = prepareRuntime();
  console.log(`migration: ${migration.reason}`);
  storage.close();
}

async function printStatus() {
  const { storage, ipc } = createApp();
  await storage.init();
  const runtime = ipc.readStatus();
  const stats = await storage.stats();

  console.log(`Mnemonic status
daemonState: ${runtime.state}
daemonMessage: ${runtime.message}
processedSessions: ${runtime.processedSessions}
lastSessionId: ${runtime.lastSessionId ?? "(none)"}
lastSource: ${runtime.lastSource ?? "(none)"}
lastMemoryCount: ${runtime.lastMemoryCount ?? 0}
totalMemories: ${stats.totalMemories}
contradictions: ${stats.contradictions}
embeddingIndexed: ${stats.embeddingIndexed}
lastIndexedAt: ${stats.lastIndexedAt ?? "(never)"}
vectorBackend: ${stats.vector.backend}
vectorTotalRows: ${stats.vector.totalRows ?? stats.vector.indexed}
vectorIndices: ${stats.vector.indices.length ? stats.vector.indices.map((index) => `${index.name}:${index.type}`).join(", ") : "(none)"}`);

  storage.close();
}

async function printStats() {
  const { storage } = createApp();
  await storage.init();
  const stats = await storage.stats();
  const memories = storage.listAll();

  console.log(`Mnemonic stats
totalMemories: ${stats.totalMemories}
contradictions: ${stats.contradictions}
embeddingIndexed: ${stats.embeddingIndexed}
vectorBackend: ${stats.vector.backend}
byLayer:
${formatCountMap(countBy(memories, (memory) => memory.layer))}
byProject:
${formatCountMap(countBy(memories, (memory) => memory.project ?? "(none)"))}
byAgent:
${formatCountMap(countBy(memories, (memory) => memory.sourceAgent))}`);

  storage.close();
}

async function runSearch(query: string) {
  const { storage } = createApp();
  await storage.init();
  const results = await storage.search(query, 10);

  if (results.length === 0) {
    console.log(`No memories found for "${query}".`);
    storage.close();
    return;
  }

  console.log(`Search: ${query}`);
  for (const result of results) {
    console.log(
      `- [${result.memory.layer}] ${result.memory.title} score=${result.score.toFixed(3)} via=${result.reasons.join(",")}`,
    );
  }
  storage.close();
}

async function runQuery(question: string) {
  const { config, storage, wiki: wikiDeps } = createApp();
  await storage.init();
  const wiki = new WikiQuery(wikiDeps.engine, wikiDeps.index);
  const searchResults = await storage.search(question, 5);
  const wikiResult = await wiki.query(question).catch(() => ({
    answer: "Wiki query unavailable.",
    sources: [],
  }));
  const synthesizedAnswer = await synthesizeQueryAnswer(question, searchResults, wikiResult);

  console.log(`Question: ${question}`);
  console.log("");
  console.log("Answer");
  console.log(synthesizedAnswer);
  console.log("");
  console.log("Evidence");
  console.log("");
  console.log("Memory");
  if (searchResults.length === 0) {
    console.log("- none");
  } else {
    for (const result of searchResults) {
      console.log(
        `- [${result.memory.layer}] ${result.memory.title} score=${result.score.toFixed(3)} via=${result.reasons.join(",")}`,
      );
    }
  }
  console.log("");
  console.log("Wiki");
  if (wikiResult.sources.length === 0) {
    console.log("- none");
  } else {
    for (const source of wikiResult.sources) {
      console.log(`- [[${source.path}]] ${source.title}${source.summary ? ` — ${source.summary}` : ""}`);
    }
  }
  console.log("");
  console.log("Source Trace");
  if (searchResults.length === 0 && wikiResult.sources.length === 0) {
    console.log("- none");
  } else {
    for (const result of searchResults) {
      console.log(`- memory:${result.memory.id}`);
      console.log(`  session=${result.memory.sourceSessionId}`);
      console.log(`  agent=${result.memory.sourceAgent}`);
      console.log(`  raw=${join(config.vault, "raw", `${result.memory.sourceSessionId}.md`)}`);
      console.log(`  note=${join(config.vault, result.memory.layer, `${result.memory.id}.md`)}`);
    }
    for (const source of wikiResult.sources) {
      console.log(`- wiki:${source.path}`);
      console.log(`  file=${source.filePath}`);
      console.log(`  updatedAt=${source.updatedAt}`);
    }
  }
  storage.close();
}

async function runReindex() {
  const { storage } = createApp();
  await storage.init();
  const result = await storage.reindex((message) => console.log(message));
  console.log(`Reindex complete: ${result.indexed}/${result.total}`);
  storage.close();
}

async function runOptimize() {
  const { storage } = createApp();
  await storage.init();
  const result = await storage.optimize((message) => console.log(message));
  console.log(`Optimize backend=${result.backend} optimized=${result.optimized ? "yes" : "no"}`);
  storage.close();
}

async function runPrune(dryRun: boolean) {
  const { storage } = createApp();
  await storage.init();
  const all = storage.listAll();

  const now = Date.now();
  const pruneAgeDays = 14;

  const toPrune = all.filter((memory) => {
    // Low-salience episodic
    if (memory.layer === "episodic" && memory.salience < 0.45) {
      const age = now - new Date(memory.createdAt).getTime();
      return age >= pruneAgeDays * 86_400_000;
    }
    // Very short summary + details across any layer
    if (memory.summary.trim().length < 50 && memory.details.trim().length < 80) {
      return true;
    }
    return false;
  });

  console.log(`Prune candidates: ${toPrune.length} / ${all.length} total memories`);

  if (toPrune.length > 0) {
    console.log("\nBreakdown:");
    const byLayer = new Map<string, number>();
    for (const m of toPrune) {
      byLayer.set(m.layer, (byLayer.get(m.layer) ?? 0) + 1);
    }
    for (const [layer, count] of byLayer) {
      console.log(`  ${layer}: ${count}`);
    }

    for (const m of toPrune.slice(0, 10)) {
      console.log(`  - [${m.layer}] sal=${m.salience} "${m.title}"`);
    }
    if (toPrune.length > 10) {
      console.log(`  ... and ${toPrune.length - 10} more`);
    }
  }

  if (!dryRun && toPrune.length > 0) {
    const keepIds = new Set(all.map((m) => m.id));
    for (const m of toPrune) keepIds.delete(m.id);
    const kept = all.filter((m) => keepIds.has(m.id));
    storage.db.withTransaction(() => {
      storage.db.replaceAllMemories(kept);
    });
    console.log(`\nPruned ${toPrune.length} memories. Remaining: ${kept.length}`);
  } else if (dryRun && toPrune.length > 0) {
    console.log("\nDry run — no changes made. Run without --dry-run to apply.");
  }

  storage.close();
}

async function runRepairWikiLinks(write: boolean) {
  const { config } = createApp();
  const result = repairWikiLinks(config.vault, { write });
  console.log(`Repair scannedFiles=${result.scannedFiles} updatedFiles=${result.updatedFiles} replacements=${result.replacements} mode=${write ? "write" : "dry-run"}`);
  if (result.unresolvedTargets.length > 0) {
    console.log("Unresolved targets:");
    for (const item of result.unresolvedTargets.slice(0, 20)) {
      console.log(`- ${item.target}: ${item.count}`);
    }
  }
}

async function runBackfill(reset: boolean) {
  const { storage, wiki } = createApp();
  await storage.init();
  if (reset) {
    await storage.reset((message) => console.log(message));
  }

  const watcher = new WatcherOrchestrator(storage, wiki);
  await watcher.backfillAll();
  const stats = await storage.stats();
  console.log(`Backfill complete: totalMemories=${stats.totalMemories} vectorBackend=${stats.vector.backend}`);
  storage.close();
}

function runResetData() {
  const paths = resolveAppPaths();
  rmSync(paths.dataRoot, { recursive: true, force: true });
  console.log(`Reset data root: ${paths.dataRoot}`);
  console.log(`Kept settings: ${paths.settingsPath}`);
}

async function runExport(format: "json" | "markdown", outputPath?: string) {
  const { config, storage } = createApp();
  await storage.init();
  const memories = storage.listAll();
  const stats = await storage.stats();
  const destination = outputPath || defaultExportPath(config.dataRoot, format);

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    format === "json" ? renderJsonExport(memories, stats) : renderMarkdownExport(memories, stats),
  );

  console.log(`Exported ${memories.length} memories to ${destination}`);
  storage.close();
}

async function runGraph(format: GraphFormat, outputPath?: string) {
  const { config, storage } = createApp();
  await storage.init();
  const memories = storage.listAll();
  const destination = outputPath || defaultGraphPath(config.dataRoot, format);

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, renderMemoryGraph(memories, format));

  console.log(`Exported graph for ${memories.length} memories to ${destination}`);
  storage.close();
}

async function synthesizeQueryAnswer(
  question: string,
  searchResults: Awaited<ReturnType<Storage["search"]>>,
  wikiResult: Awaited<ReturnType<WikiQuery["query"]>>,
) {
  if (searchResults.length === 0 && wikiResult.sources.length === 0) {
    return "No relevant memories or wiki pages found.\nConfidence: low";
  }

  try {
    return await llmGenerate(
      combinedQueryPrompt(
        question,
        searchResults.map((result) => ({
          id: result.memory.id,
          layer: result.memory.layer,
          title: result.memory.title,
          summary: result.memory.summary,
          details: result.memory.details,
          score: result.score,
          reasons: result.reasons,
          sourceSessionId: result.memory.sourceSessionId,
          sourceAgent: result.memory.sourceAgent,
        })),
        wikiResult.sources,
      ),
    );
  } catch {
    return wikiResult.answer;
  }
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
${formatEmbeddingStatus(settings.embedding)}`);
    return;
  }

  console.log(`openai: oauth
accountId: ${settings.accountId ?? "(none)"}
expiresAt: ${new Date(settings.expiresAt).toISOString()}
model: ${settings.model}
${formatEmbeddingStatus(settings.embedding)}`);
}

function printAuthList() {
  const settings = loadSettings();
  if (!settings) {
    console.log("No providers configured.");
    return;
  }
  const providers = [`openai (${settings.authMode})`];
  if (settings.embedding) {
    providers.push(`embedding (${settings.embedding.provider})`);
  }
  console.log(providers.join("\n"));
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

  const settings: ApiSettings = {
    authMode: "api",
    apiKey,
    baseURL,
    model,
    embedding: existing?.embedding,
  };

  saveSettings(settings);
  invalidateEmbeddingCache();
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

  const settings: OAuthSettings = {
    authMode: "oauth",
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    accountId: oauth.accountId,
    model,
    embedding: existing?.embedding,
  };

  saveSettings(settings);
  invalidateEmbeddingCache();
  console.log("Saved OpenAI OAuth auth.");
}

function logoutOpenAI() {
  const settings = loadSettings();
  if (!settings) {
    console.log("No auth configured.");
    return;
  }
  removeSettings();
  invalidateEmbeddingCache();
  console.log("Removed OpenAI auth.");
}

function formatEmbeddingStatus(embedding: EmbeddingSettings | undefined) {
  if (!embedding) {
    return "embedding: not configured";
  }

  const lines = [
    `embedding: ${embedding.provider}`,
    `embeddingBaseURL: ${embedding.baseURL}`,
    `embeddingModel: ${embedding.model}`,
  ];

  if ("apiKey" in embedding) {
    lines.push(
      `embeddingApiKey: ${embedding.apiKey ? `${embedding.apiKey.slice(0, 8)}••••••••` : "(empty)"}`,
    );
  }

  return lines.join("\n");
}

function formatCountMap(counts: Map<string, number>) {
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length === 0) {
    return "- (none)";
  }
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function defaultExportPath(dataRoot: string, format: "json" | "markdown") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = format === "json" ? "json" : "md";
  return join(dataRoot, "exports", `mnemonic-export-${stamp}.${extension}`);
}

function defaultGraphPath(dataRoot: string, format: GraphFormat) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = format === "mermaid" ? "mmd" : format;
  return join(dataRoot, "exports", `mnemonic-graph-${stamp}.${extension}`);
}

function renderJsonExport(memories: Storage["listAll"] extends () => infer T ? T : never, stats: Awaited<ReturnType<Storage["stats"]>>) {
  return `${JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalMemories: stats.totalMemories,
      contradictions: stats.contradictions,
      vectorBackend: stats.vector.backend,
      memories,
    },
    null,
    2,
  )}\n`;
}

function renderMarkdownExport(
  memories: Storage["listAll"] extends () => infer T ? T : never,
  stats: Awaited<ReturnType<Storage["stats"]>>,
) {
  const byLayer = countBy(memories, (memory) => memory.layer);
  const grouped = new Map<string, typeof memories>();
  for (const memory of memories) {
    const group = grouped.get(memory.layer) ?? [];
    group.push(memory);
    grouped.set(memory.layer, group);
  }

  return [
    "# Mnemonic Export",
    "",
    `- exportedAt: ${new Date().toISOString()}`,
    `- totalMemories: ${stats.totalMemories}`,
    `- contradictions: ${stats.contradictions}`,
    `- vectorBackend: ${stats.vector.backend}`,
    "",
    "## Summary",
    "",
    formatCountMap(byLayer),
    "",
    ...[...grouped.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .flatMap(([layer, layerMemories]) => [
        `## ${layer}`,
        "",
        ...layerMemories.map((memory) =>
          [
            `### ${memory.title}`,
            "",
            `- id: ${memory.id}`,
            `- project: ${memory.project ?? "(none)"}`,
            `- sourceAgent: ${memory.sourceAgent}`,
            `- sourceSessionId: ${memory.sourceSessionId}`,
            `- createdAt: ${memory.createdAt}`,
            `- updatedAt: ${memory.updatedAt}`,
            `- status: ${memory.status}`,
            `- sourceSessionIds: ${memory.sourceSessionIds.join(", ") || "(none)"}`,
            `- supportingMemoryIds: ${memory.supportingMemoryIds.join(", ") || "(none)"}`,
            `- salience: ${memory.salience}`,
            `- tags: ${memory.tags.join(", ") || "(none)"}`,
            "",
            memory.summary,
            "",
          ].join("\n"),
        ),
      ]),
  ].join("\n");
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
      invalidateEmbeddingCache();
      return;
    case "paths":
      printPaths();
      return;
    case "status":
      await printStatus();
      return;
    case "stats":
      await printStats();
      return;
    case "backfill":
      await runBackfill(command.reset);
      return;
    case "reset-data":
      runResetData();
      return;
    case "reindex":
      await runReindex();
      return;
    case "optimize":
      await runOptimize();
      return;
    case "prune":
      await runPrune(command.dryRun);
      return;
    case "repair-wikilinks":
      await runRepairWikiLinks(command.write);
      return;
    case "export":
      await runExport(command.format, command.outputPath);
      return;
    case "graph":
      await runGraph(command.format, command.outputPath);
      return;
    case "search":
      await runSearch(command.query);
      return;
    case "query":
      await runQuery(command.question);
      return;
    case "doctor":
      await printDoctor();
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
    case "unknown":
      console.error(`\x1b[31mUnknown command: ${command.input}. Run 'mnemonic help' for usage.\x1b[0m`);
      printHelp();
      process.exit(1);
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
