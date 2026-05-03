import type { Memory } from "../types";

const SALIENCE_BANDS = {
  top: { min: 0.9, max: 1.0, lower: 0.9, upper: 1.0 },
  high: { min: 0.65, max: 0.9, lower: 0.7, upper: 0.85 },
  mid: { min: 0.25, max: 0.65, lower: 0.5, upper: 0.7 },
  low: { min: 0, max: 0.25, lower: 0.3, upper: 0.5 },
} as const;

/**
 * Remap salience by percentile within one session batch:
 * - p90+ => 0.9-1.0
 * - p65-90 => 0.7-0.85
 * - p25-65 => 0.5-0.7
 * - <p25 => 0.3-0.5
 *
 * Insight memories and verified memories are left unchanged.
 * If fewer than 4 eligible memories exist, no remapping is applied.
 */
export function calibrateSalience(memories: Memory[]): Memory[] {
  const eligible = memories
    .map((memory, index) => ({ memory, index }))
    .filter(({ memory }) => memory.layer !== "insight" && memory.status !== "verified");

  if (eligible.length < 4) {
    return memories;
  }

  const ranked = [...eligible].sort((left, right) => {
    if (right.memory.salience !== left.memory.salience) {
      return right.memory.salience - left.memory.salience;
    }

    return left.index - right.index;
  });

  const calibratedByIndex = new Map<number, number>();
  const denominator = Math.max(1, ranked.length - 1);

  for (const [rank, item] of ranked.entries()) {
    const percentile = rank / denominator;
    calibratedByIndex.set(item.index, mapPercentileToSalience(percentile));
  }

  return memories.map((memory, index) => {
    const calibrated = calibratedByIndex.get(index);
    if (calibrated === undefined) {
      return memory;
    }

    return {
      ...memory,
      salience: calibrated,
    };
  });
}

function mapPercentileToSalience(percentile: number) {
  if (percentile >= SALIENCE_BANDS.top.min) {
    return interpolate(
      percentile,
      SALIENCE_BANDS.top.min,
      SALIENCE_BANDS.top.max,
      SALIENCE_BANDS.top.lower,
      SALIENCE_BANDS.top.upper,
    );
  }

  if (percentile >= SALIENCE_BANDS.high.min) {
    return interpolate(
      percentile,
      SALIENCE_BANDS.high.min,
      SALIENCE_BANDS.high.max,
      SALIENCE_BANDS.high.lower,
      SALIENCE_BANDS.high.upper,
    );
  }

  if (percentile >= SALIENCE_BANDS.mid.min) {
    return interpolate(
      percentile,
      SALIENCE_BANDS.mid.min,
      SALIENCE_BANDS.mid.max,
      SALIENCE_BANDS.mid.lower,
      SALIENCE_BANDS.mid.upper,
    );
  }

  return interpolate(
    percentile,
    SALIENCE_BANDS.low.min,
    SALIENCE_BANDS.low.max,
    SALIENCE_BANDS.low.lower,
    SALIENCE_BANDS.low.upper,
  );
}

function interpolate(value: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const span = inMax - inMin;
  if (span <= 0) {
    return outMin;
  }

  const normalized = (value - inMin) / span;
  const clamped = Math.max(0, Math.min(1, normalized));
  const mapped = outMin + clamped * (outMax - outMin);
  return Math.max(0, Math.min(1, mapped));
}
