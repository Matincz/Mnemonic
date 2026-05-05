import type { Storage } from "../storage";
import type { Memory } from "../types";

export interface SalienceRecalibrationResult {
  checked: number;
  updated: number;
}

const TARGET_POINTS = [
  { percentile: 0, salience: 0.2 },
  { percentile: 0.25, salience: 0.3 },
  { percentile: 0.5, salience: 0.5 },
  { percentile: 0.75, salience: 0.7 },
  { percentile: 0.9, salience: 0.85 },
  { percentile: 0.99, salience: 0.95 },
  { percentile: 1, salience: 0.98 },
];

export async function globalSalienceRecalibration(storage: Storage): Promise<SalienceRecalibrationResult> {
  const eligible = storage
    .listAll()
    .filter((memory) => memory.status !== "verified" && memory.status !== "superseded")
    .sort((left, right) => left.salience - right.salience || left.createdAt.localeCompare(right.createdAt));

  if (eligible.length < 2) {
    return { checked: eligible.length, updated: 0 };
  }

  const now = new Date().toISOString();
  const updates: Memory[] = [];
  for (let index = 0; index < eligible.length; index += 1) {
    const memory = eligible[index]!;
    const percentile = eligible.length === 1 ? 1 : index / (eligible.length - 1);
    const salience = roundSalience(interpolateTargetSalience(percentile));
    if (Math.abs(memory.salience - salience) < 0.001) {
      continue;
    }

    updates.push({
      ...memory,
      salience,
      updatedAt: now,
    });
  }

  await storage.updateMemoryMetadata(updates);
  return { checked: eligible.length, updated: updates.length };
}

function interpolateTargetSalience(percentile: number) {
  for (let index = 1; index < TARGET_POINTS.length; index += 1) {
    const previous = TARGET_POINTS[index - 1]!;
    const next = TARGET_POINTS[index]!;
    if (percentile > next.percentile) {
      continue;
    }

    const span = next.percentile - previous.percentile;
    const ratio = span === 0 ? 0 : (percentile - previous.percentile) / span;
    return previous.salience + (next.salience - previous.salience) * ratio;
  }

  return TARGET_POINTS.at(-1)!.salience;
}

function roundSalience(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}
