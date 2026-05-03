import { describe, expect, it } from "bun:test";
import { calibrateSalience } from "../../src/pipeline/salience";
import type { Memory } from "../../src/types";

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    layer: "episodic",
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
    supportingMemoryIds: [],
    salience: 0.9,
    linkedMemoryIds: [],
    contradicts: [],
    ...overrides,
  };
}

describe("calibrateSalience", () => {
  it("remaps a uniform batch into target percentile bands", () => {
    const memories = Array.from({ length: 10 }, (_, index) => makeMemory(`mem-${index + 1}`));
    const calibrated = calibrateSalience(memories);
    const saliences = calibrated.map((memory) => memory.salience);

    expect(Math.max(...saliences)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...saliences)).toBeLessThanOrEqual(1);
    expect(Math.min(...saliences)).toBeGreaterThanOrEqual(0.3);
    expect(Math.min(...saliences)).toBeLessThanOrEqual(0.5);
  });

  it("keeps small batches unchanged", () => {
    const memories = [makeMemory("m1", { salience: 0.2 }), makeMemory("m2", { salience: 0.7 }), makeMemory("m3", { salience: 0.9 })];
    const calibrated = calibrateSalience(memories);
    expect(calibrated).toEqual(memories);
  });

  it("does not lower verified or insight memories", () => {
    const verified = makeMemory("verified", { status: "verified", salience: 0.95 });
    const insight = makeMemory("insight", { layer: "insight", salience: 0.92 });
    const others = [
      makeMemory("m1", { salience: 0.95 }),
      makeMemory("m2", { salience: 0.9 }),
      makeMemory("m3", { salience: 0.85 }),
      makeMemory("m4", { salience: 0.8 }),
    ];
    const calibrated = calibrateSalience([verified, insight, ...others]);

    expect(calibrated[0]?.salience).toBe(0.95);
    expect(calibrated[1]?.salience).toBe(0.92);
  });
});
