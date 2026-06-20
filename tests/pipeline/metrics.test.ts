import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Storage } from "../../src/storage";
import { auditCorpusQuality, recordMetrics, summarizeMetrics, type PipelineMetrics } from "../../src/pipeline/metrics";
import type { Memory } from "../../src/types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeStorage() {
  const root = join(tmpdir(), `mnemonic-metrics-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

function metric(sessionId: string, overrides: Partial<PipelineMetrics> = {}): PipelineMetrics {
  return {
    sessionId,
    project: "proj-a",
    ingestedRaw: 10,
    ingestedAfterCalibration: 10,
    ingestedAfterDedup: 8,
    dedupMerged: 1,
    dedupDropped: 1,
    crossLayerLinked: 2,
    reflectorAdded: 1,
    consolidatorMerged: 1,
    consolidatorSynthesized: 0,
    statusUpgraded: 1,
    contradictsSuperseded: 0,
    verifiedRatio: 0.1,
    supersededAdded: 0,
    contradictsAdded: 0,
    multiSourceRatio: 0.2,
    projectCoverage: 0.8,
    duplicateTitleGroups: 1,
    salienceDistribution: { p25: 0.4, p50: 0.6, p75: 0.8, p90: 0.9 },
    ...overrides,
  };
}

function memory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "semantic",
    title: `Memory ${id}`,
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    tags: [],
    project: "proj-a",
    sourceSessionId: `session-${id}`,
    sourceAgent: "codex",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "observed",
    sourceSessionIds: [`session-${id}`],
    supportingMemoryIds: [],
    salience: 0.5,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

describe("pipeline metrics", () => {
  it("writes metrics and summarizes recent aggregates", async () => {
    const storage = makeStorage();
    await storage.init();

    await recordMetrics(storage, metric("session-1"));
    await recordMetrics(storage, metric("session-2", { project: "proj-b", ingestedRaw: 20, dedupMerged: 4, dedupDropped: 1, statusUpgraded: 2 }));
    await recordMetrics(storage, metric("session-3", { project: "proj-b", ingestedRaw: 5, dedupMerged: 0, dedupDropped: 0, statusUpgraded: 0 }));

    const summary = await summarizeMetrics(storage, 7);
    expect(summary.sessions).toBe(3);
    expect(summary.averages.ingestedRaw).toBeCloseTo(35 / 3, 6);
    expect(summary.statusUpgraded).toBe(3);
    expect(summary.verifiedRatio).toBeCloseTo(0.1, 6);
    expect(summary.multiSourceRatio).toBeCloseTo(0.2, 6);
    expect(summary.projectCoverage).toBeCloseTo(0.8, 6);
    expect(summary.duplicateTitleGroups).toBe(1);
    expect(summary.salienceDistribution.p50).toBe(0.6);
    expect(summary.topDedupProjects[0]?.project).toBe("proj-b");

    storage.close();
  });

  it("audits corpus quality directly from stored memories and vault files", async () => {
    const storage = makeStorage();
    await storage.init();
    const memories = [
      memory("mem-1", { title: "Duplicate title", status: "verified", sourceSessionIds: ["s1", "s2"] }),
      memory("mem-2", { title: "Duplicate title", status: "superseded", project: undefined, contradicts: ["mem-3"] }),
      memory("mem-3", { title: "Unique title", project: "general" }),
    ];
    for (const item of memories) {
      storage.db.upsertMemory(item);
      storage.vault.writeMemory(item);
    }

    const audit = auditCorpusQuality(storage);

    expect(audit.totalMemories).toBe(3);
    expect(audit.verifiedRatio).toBeCloseTo(1 / 3, 6);
    expect(audit.supersededCount).toBe(1);
    expect(audit.contradictsMemoryRatio).toBeCloseTo(1 / 3, 6);
    expect(audit.contradictsLinkCount).toBe(1);
    expect(audit.multiSourceRatio).toBeCloseTo(1 / 3, 6);
    expect(audit.projectCoverage).toBeCloseTo(2 / 3, 6);
    expect(audit.duplicateTitleGroups).toBe(1);
    expect(audit.vaultMemoryFiles).toBe(3);
    expect(audit.vaultCoverage).toBe(1);

    storage.close();
  });
});
