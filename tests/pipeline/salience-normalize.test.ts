import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Storage } from "../../src/storage";
import { globalSalienceRecalibration } from "../../src/pipeline/salience-normalize";
import { salienceDistribution } from "../../src/pipeline/metrics";
import type { Memory } from "../../src/types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeStorage() {
  const root = join(tmpdir(), `mnemonic-salience-normalize-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  return new Storage({
    dbPath: join(root, "memory.db"),
    vaultPath: join(root, "vault"),
    config: {
      vectorBackend: "sqlite",
      sqlitePath: join(root, "memory.db"),
      vault: join(root, "vault"),
      dataRoot: root,
      dataDir: root,
      lanceDir: join(root, "lance"),
      configRoot: root,
      settingsPath: join(root, "settings.json"),
      ipcDir: join(root, "ipc"),
      ipcStatusPath: join(root, "ipc", "status.json"),
      ipcEventsPath: join(root, "ipc", "events.ndjson"),
    } as never,
  });
}

function makeMemory(id: string, salience: number): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: [],
    project: "mnemonic",
    sourceSessionId: "session-1",
    sourceAgent: "codex",
    createdAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
    status: "observed",
    sourceSessionIds: ["session-1"],
    sourceAgents: ["codex"],
    supportingMemoryIds: [],
    salience,
    linkedMemoryIds: [],
    contradicts: [],
  };
}

describe("globalSalienceRecalibration", () => {
  it("remaps a high-skew corpus into target percentile bands", async () => {
    const storage = makeStorage();
    await storage.init();
    await storage.saveMemories(Array.from({ length: 200 }, (_, index) => makeMemory(`mem-${index}`, 0.7 + index * 0.001)));

    const result = await globalSalienceRecalibration(storage);
    const distribution = salienceDistribution(storage.listAll().map((memory) => memory.salience));

    expect(result.updated).toBeGreaterThan(180);
    expect(distribution.p50).toBeGreaterThanOrEqual(0.45);
    expect(distribution.p50).toBeLessThanOrEqual(0.55);
    expect(distribution.p90).toBeGreaterThanOrEqual(0.8);
    expect(distribution.p90).toBeLessThanOrEqual(0.9);

    storage.close();
  });
});
