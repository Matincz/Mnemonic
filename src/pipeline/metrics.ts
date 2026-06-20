import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Storage } from "../storage";
import type { Memory } from "../types";

export interface PipelineMetrics {
  sessionId: string;
  project?: string;
  ingestedRaw: number;
  ingestedAfterCalibration: number;
  ingestedAfterDedup: number;
  dedupMerged: number;
  dedupDropped: number;
  crossLayerLinked: number;
  reflectorAdded: number;
  consolidatorMerged: number;
  consolidatorSynthesized: number;
  statusUpgraded: number;
  contradictsSuperseded: number;
  verifiedRatio: number;
  supersededAdded: number;
  contradictsAdded: number;
  multiSourceRatio: number;
  projectCoverage: number;
  duplicateTitleGroups: number;
  salienceDistribution: { p25: number; p50: number; p75: number; p90: number };
}

export interface MetricsSummary {
  sinceDays: number;
  sessions: number;
  averages: {
    ingestedRaw: number;
    ingestedAfterCalibration: number;
    ingestedAfterDedup: number;
    dedupMerged: number;
    dedupDropped: number;
  };
  salienceDistribution: { p25: number; p50: number; p75: number; p90: number };
  statusUpgraded: number;
  verifiedRatio: number;
  supersededAdded: number;
  contradictsAdded: number;
  multiSourceRatio: number;
  projectCoverage: number;
  duplicateTitleGroups: number;
  topDedupProjects: Array<{ project: string; sessions: number; dedupRate: number; dedupMerged: number; dedupDropped: number; ingestedRaw: number }>;
}

export interface CorpusQualityAudit {
  sqlitePath: string;
  vaultPath: string;
  totalMemories: number;
  verifiedRatio: number;
  supersededCount: number;
  contradictsMemoryRatio: number;
  contradictsLinkCount: number;
  multiSourceRatio: number;
  projectCoverage: number;
  duplicateTitleGroups: number;
  vaultMemoryFiles: number;
  vaultCoverage: number;
}

export async function recordMetrics(storage: Storage, metrics: PipelineMetrics): Promise<void> {
  storage.db.recordPipelineMetrics(metrics);
}

export async function summarizeMetrics(storage: Storage, sinceDays: number): Promise<MetricsSummary> {
  const rows = storage.db.listPipelineMetricsSince(new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  const metrics = rows.map((row) => normalizeMetric(row.payload));
  const sessions = metrics.length;

  return {
    sinceDays,
    sessions,
    averages: {
      ingestedRaw: average(metrics.map((metric) => metric.ingestedRaw)),
      ingestedAfterCalibration: average(metrics.map((metric) => metric.ingestedAfterCalibration)),
      ingestedAfterDedup: average(metrics.map((metric) => metric.ingestedAfterDedup)),
      dedupMerged: average(metrics.map((metric) => metric.dedupMerged)),
      dedupDropped: average(metrics.map((metric) => metric.dedupDropped)),
    },
    salienceDistribution: {
      p25: average(metrics.map((metric) => metric.salienceDistribution.p25)),
      p50: average(metrics.map((metric) => metric.salienceDistribution.p50)),
      p75: average(metrics.map((metric) => metric.salienceDistribution.p75)),
      p90: average(metrics.map((metric) => metric.salienceDistribution.p90)),
    },
    statusUpgraded: sum(metrics.map((metric) => metric.statusUpgraded)),
    verifiedRatio: average(metrics.map((metric) => metric.verifiedRatio)),
    supersededAdded: sum(metrics.map((metric) => metric.supersededAdded)),
    contradictsAdded: sum(metrics.map((metric) => metric.contradictsAdded)),
    multiSourceRatio: average(metrics.map((metric) => metric.multiSourceRatio)),
    projectCoverage: average(metrics.map((metric) => metric.projectCoverage)),
    duplicateTitleGroups: Math.max(0, ...metrics.map((metric) => metric.duplicateTitleGroups)),
    topDedupProjects: summarizeDedupProjects(metrics),
  };
}

export function salienceDistribution(values: number[]): PipelineMetrics["salienceDistribution"] {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  return {
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };
}

export function auditCorpusQuality(storage: Storage): CorpusQualityAudit {
  const memories = storage.listAll();
  const total = memories.length;
  const vaultMemoryFiles = countVaultMemoryFiles(storage.config.vault);

  return {
    sqlitePath: storage.config.sqlitePath,
    vaultPath: storage.config.vault,
    totalMemories: total,
    verifiedRatio: ratio(memories.filter((memory) => memory.status === "verified").length, total),
    supersededCount: memories.filter((memory) => memory.status === "superseded").length,
    contradictsMemoryRatio: ratio(memories.filter((memory) => (memory.contradicts ?? []).length > 0).length, total),
    contradictsLinkCount: memories.reduce((count, memory) => count + (memory.contradicts ?? []).length, 0),
    multiSourceRatio: ratio(memories.filter((memory) => (memory.sourceSessionIds ?? []).length > 1).length, total),
    projectCoverage: ratio(memories.filter((memory) => Boolean(memory.project)).length, total),
    duplicateTitleGroups: countDuplicateTitleGroups(memories),
    vaultMemoryFiles,
    vaultCoverage: ratio(vaultMemoryFiles, total),
  };
}

export function countDuplicateTitleGroups(memories: Memory[]) {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    const title = memory.title.trim().toLowerCase();
    if (!title) {
      continue;
    }
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }

  return [...counts.values()].filter((count) => count > 1).length;
}

function summarizeDedupProjects(metrics: PipelineMetrics[]) {
  const projects = new Map<string, { sessions: number; dedupMerged: number; dedupDropped: number; ingestedRaw: number }>();
  for (const metric of metrics) {
    const project = metric.project ?? "(none)";
    const current = projects.get(project) ?? { sessions: 0, dedupMerged: 0, dedupDropped: 0, ingestedRaw: 0 };
    current.sessions += 1;
    current.dedupMerged += metric.dedupMerged;
    current.dedupDropped += metric.dedupDropped;
    current.ingestedRaw += metric.ingestedRaw;
    projects.set(project, current);
  }

  return [...projects.entries()]
    .map(([project, value]) => ({
      project,
      ...value,
      dedupRate: value.ingestedRaw === 0 ? 0 : (value.dedupMerged + value.dedupDropped) / value.ingestedRaw,
    }))
    .sort((left, right) => right.dedupRate - left.dedupRate || right.ingestedRaw - left.ingestedRaw)
    .slice(0, 5);
}

function normalizeMetric(metric: PipelineMetrics): PipelineMetrics {
  return {
    ...metric,
    verifiedRatio: metric.verifiedRatio ?? 0,
    supersededAdded: metric.supersededAdded ?? metric.contradictsSuperseded ?? 0,
    contradictsAdded: metric.contradictsAdded ?? 0,
    multiSourceRatio: metric.multiSourceRatio ?? 0,
    projectCoverage: metric.projectCoverage ?? 0,
    duplicateTitleGroups: metric.duplicateTitleGroups ?? 0,
  };
}

function average(values: number[]) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(count: number, total: number) {
  return total === 0 ? 0 : count / total;
}

function percentile(sorted: number[], quantile: number) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function countVaultMemoryFiles(vaultPath: string) {
  if (!existsSync(vaultPath)) {
    return 0;
  }

  return ["episodic", "semantic", "procedural", "insight"].reduce((total, layer) => {
    const dir = join(vaultPath, layer);
    if (!existsSync(dir)) {
      return total;
    }
    return total + countMarkdownFiles(dir);
  }, 0);
}

function countMarkdownFiles(dir: string): number {
  return readdirSync(dir).reduce((total, entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return total + countMarkdownFiles(path);
    }
    return total + (entry.endsWith(".md") ? 1 : 0);
  }, 0);
}
