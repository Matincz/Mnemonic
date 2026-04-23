import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("cli parsing", () => {
  it("parses openai browser auth command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["auth", "openai", "browser"])).toEqual({
      name: "auth-openai-browser",
    });
  });

  it("parses auth status command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["auth", "status"])).toEqual({
      name: "auth-status",
    });
  });

  it("defaults to help for unknown commands", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["wat"])).toEqual({
      name: "unknown",
      input: "wat",
    });
  });

  it("parses search command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["search", "auth", "bug"])).toEqual({
      name: "search",
      query: "auth bug",
    });
  });

  it("parses optimize command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["optimize"])).toEqual({
      name: "optimize",
    });
  });

  it("parses repair-wikilinks command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["repair-wikilinks", "--write"])).toEqual({
      name: "repair-wikilinks",
      write: true,
    });
  });

  it("parses stats command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["stats"])).toEqual({
      name: "stats",
    });
  });

  it("parses reset-data command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["reset-data"])).toEqual({
      name: "reset-data",
    });
  });

  it("parses export command with format and path", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["export", "json", "/tmp/out.json"])).toEqual({
      name: "export",
      format: "json",
      outputPath: "/tmp/out.json",
    });
  });

  it("parses graph command with format and path", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["graph", "dot", "/tmp/graph.dot"])).toEqual({
      name: "graph",
      format: "dot",
      outputPath: "/tmp/graph.dot",
    });
  });

  it("parses query command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["query", "How", "do", "we", "auth?"])).toEqual({
      name: "query",
      question: "How do we auth?",
    });
  });

  it("prints auth status with current oauth fields", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-cli-"));
    const settingsPath = join(tempDir, "settings.json");
    process.env.MEMORY_AGENT_SETTINGS_PATH = settingsPath;
    writeFileSync(
      settingsPath,
      JSON.stringify({
        authMode: "oauth",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: 123456789,
        accountId: "acct_123",
        model: "gpt-5.4",
        embedding: {
          provider: "local",
          baseURL: "http://127.0.0.1:11434/v1",
          model: "nomic-embed-text",
        },
      }),
    );

    const { runCli } = await import("../src/cli");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    try {
      await runCli(["auth", "status"]);
    } finally {
      console.log = originalLog;
      delete process.env.MEMORY_AGENT_SETTINGS_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(logs.join("\n")).toBe(
      [
        "openai: oauth",
        "accountId: acct_123",
        "expiresAt: 1970-01-02T10:17:36.789Z",
        "model: gpt-5.4",
        "embedding: local",
        "embeddingBaseURL: http://127.0.0.1:11434/v1",
        "embeddingModel: nomic-embed-text",
      ].join("\n"),
    );
  });

  it("prints status with vector backend details", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-status-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;
    process.env.MNEMONIC_VECTOR_BACKEND = "sqlite";

    const { runCli } = await import("../src/cli");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    try {
      await runCli(["status"]);
    } finally {
      console.log = originalLog;
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
      delete process.env.MNEMONIC_VECTOR_BACKEND;
      rmSync(tempDir, { recursive: true, force: true });
    }

    const output = logs.join("\n");
    expect(output).toContain("vectorBackend: sqlite");
    expect(output).toContain("vectorIndices: (none)");
  });

  it("prints doctor with vector backend details", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-doctor-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;
    process.env.MNEMONIC_VECTOR_BACKEND = "sqlite";

    const { runCli } = await import("../src/cli");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    try {
      await runCli(["doctor"]);
    } finally {
      console.log = originalLog;
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
      delete process.env.MNEMONIC_VECTOR_BACKEND;
      rmSync(tempDir, { recursive: true, force: true });
    }

    const output = logs.join("\n");
    expect(output).toContain("vectorBackend: sqlite");
    expect(output).toContain("vectorIndices: (none)");
    expect(output).toContain("lanceDir:");
  });

  it("prints grouped stats output", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-stats-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    const dbDir = join(dataRoot, "data");
    mkdirSync(dbDir, { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;
    process.env.MNEMONIC_VECTOR_BACKEND = "sqlite";

    const { Storage } = await import("../src/storage");
    const storage = new Storage();
    await storage.init();
    await storage.saveMemories([
      {
        id: "mem-1",
        layer: "semantic",
        title: "Auth flow",
        summary: "Auth summary",
        details: "Auth details",
        tags: ["auth"],
        project: "proj-a",
        sourceSessionId: "sess-1",
        sourceAgent: "codex",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "observed",
        sourceSessionIds: ["sess-1"],
        supportingMemoryIds: [],
        salience: 0.8,
        linkedMemoryIds: [],
        contradicts: [],
      },
      {
        id: "mem-2",
        layer: "insight",
        title: "Bug cause",
        summary: "Bug summary",
        details: "Bug details",
        tags: ["bug"],
        project: "proj-a",
        sourceSessionId: "sess-2",
        sourceAgent: "claude-code",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "observed",
        sourceSessionIds: ["sess-2"],
        supportingMemoryIds: [],
        salience: 0.7,
        linkedMemoryIds: [],
        contradicts: [],
      },
    ]);
    storage.close();

    const { runCli } = await import("../src/cli");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    try {
      await runCli(["stats"]);
    } finally {
      console.log = originalLog;
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
      delete process.env.MNEMONIC_VECTOR_BACKEND;
      rmSync(tempDir, { recursive: true, force: true });
    }

    const output = logs.join("\n");
    expect(output).toContain("Mnemonic stats");
    expect(output).toContain("- semantic: 1");
    expect(output).toContain("- insight: 1");
    expect(output).toContain("- proj-a: 2");
    expect(output).toContain("- codex: 1");
    expect(output).toContain("- claude-code: 1");
  });

  it("resets generated data without deleting settings", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-reset-data-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    writeFileSync(join(dataRoot, "data", "memory.db"), "placeholder");
    writeFileSync(join(configRoot, "settings.json"), JSON.stringify({ authMode: "api" }));
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;

    const { runCli } = await import("../src/cli");
    try {
      await runCli(["reset-data"]);
    } finally {
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
    }

    expect(existsSync(dataRoot)).toBe(false);
    expect(existsSync(join(configRoot, "settings.json"))).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports memories as json", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-export-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    const outputPath = join(tempDir, "export.json");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;
    process.env.MNEMONIC_VECTOR_BACKEND = "sqlite";

    const { Storage } = await import("../src/storage");
    const storage = new Storage();
    await storage.init();
    await storage.saveMemories([
      {
        id: "mem-export",
        layer: "procedural",
        title: "Deploy steps",
        summary: "Deploy summary",
        details: "Deploy details",
        tags: ["deploy"],
        project: "proj-export",
        sourceSessionId: "sess-export",
        sourceAgent: "codex",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "observed",
        sourceSessionIds: ["sess-export"],
        supportingMemoryIds: [],
        salience: 0.9,
        linkedMemoryIds: [],
        contradicts: [],
      },
    ]);
    storage.close();

    const { runCli } = await import("../src/cli");
    try {
      await runCli(["export", "json", outputPath]);
    } finally {
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
      delete process.env.MNEMONIC_VECTOR_BACKEND;
    }

    const exported = JSON.parse(readFileSync(outputPath, "utf8")) as {
      totalMemories: number;
      vectorBackend: string;
      memories: Array<{ id: string }>;
    };
    expect(exported.totalMemories).toBe(1);
    expect(exported.vectorBackend).toBe("sqlite");
    expect(exported.memories[0]?.id).toBe("mem-export");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports memories as markdown", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-export-md-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    const outputPath = join(tempDir, "export.md");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;
    process.env.MNEMONIC_VECTOR_BACKEND = "sqlite";

    const { Storage } = await import("../src/storage");
    const storage = new Storage();
    await storage.init();
    await storage.saveMemories([
      {
        id: "mem-export-md",
        layer: "insight",
        title: "Retry rule",
        summary: "Retry summary",
        details: "Retry details",
        tags: ["retry"],
        project: "proj-md",
        sourceSessionId: "sess-md",
        sourceAgent: "codex",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "observed",
        sourceSessionIds: ["sess-md"],
        supportingMemoryIds: [],
        salience: 0.6,
        linkedMemoryIds: [],
        contradicts: [],
      },
    ]);
    storage.close();

    const { runCli } = await import("../src/cli");
    try {
      await runCli(["export", "markdown", outputPath]);
    } finally {
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
      delete process.env.MNEMONIC_VECTOR_BACKEND;
    }

    const exported = readFileSync(outputPath, "utf8");
    expect(exported).toContain("# Mnemonic Export");
    expect(exported).toContain("## insight");
    expect(exported).toContain("### Retry rule");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports graph as mermaid", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-graph-"));
    const dataRoot = join(tempDir, "data-root");
    const configRoot = join(tempDir, "config-root");
    const outputPath = join(tempDir, "graph.mmd");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(configRoot, { recursive: true });
    process.env.MNEMONIC_DATA_ROOT = dataRoot;
    process.env.MNEMONIC_CONFIG_ROOT = configRoot;
    process.env.MNEMONIC_VECTOR_BACKEND = "sqlite";

    const { Storage } = await import("../src/storage");
    const storage = new Storage();
    await storage.init();
    await storage.saveMemories([
      {
        id: "mem-a",
        layer: "semantic",
        title: "Auth model",
        summary: "Auth summary",
        details: "Auth details",
        tags: ["auth"],
        project: "proj-graph",
        sourceSessionId: "sess-a",
        sourceAgent: "codex",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "observed",
        sourceSessionIds: ["sess-a"],
        supportingMemoryIds: [],
        salience: 0.8,
        linkedMemoryIds: ["mem-b"],
        contradicts: [],
      },
      {
        id: "mem-b",
        layer: "procedural",
        title: "Deploy flow",
        summary: "Deploy summary",
        details: "Deploy details",
        tags: ["deploy"],
        project: "proj-graph",
        sourceSessionId: "sess-b",
        sourceAgent: "codex",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "observed",
        sourceSessionIds: ["sess-b"],
        supportingMemoryIds: [],
        salience: 0.7,
        linkedMemoryIds: [],
        contradicts: [],
      },
    ]);
    storage.close();

    const { runCli } = await import("../src/cli");
    try {
      await runCli(["graph", "mermaid", outputPath]);
    } finally {
      delete process.env.MNEMONIC_DATA_ROOT;
      delete process.env.MNEMONIC_CONFIG_ROOT;
      delete process.env.MNEMONIC_VECTOR_BACKEND;
    }

    const graph = readFileSync(outputPath, "utf8");
    expect(graph).toContain("flowchart TD");
    expect(graph).toContain("mem_a");
    expect(graph).toContain("-->");

    rmSync(tempDir, { recursive: true, force: true });
  });
});
