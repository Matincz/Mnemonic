import { describe, expect, it } from "bun:test";
import { BatchLinkResultSchema, LinkResultSchema, RawMemorySchema, WikiOperationSchema } from "../../src/llm/schemas";

describe("Link schemas", () => {
  it("defaults missing link arrays to empty arrays", () => {
    const parsed = LinkResultSchema.parse({
      explanation: "No related memories were relevant.",
    });

    expect(parsed.linked_ids).toEqual([]);
    expect(parsed.contradicts_ids).toEqual([]);
  });

  it("defaults missing contradicts arrays in batch link results", () => {
    const parsed = BatchLinkResultSchema.parse([
      {
        memory_id: "mem-1",
        linked_ids: ["candidate-1"],
        explanation: "Matched prior auth guidance.",
      },
      {
        memory_id: "mem-2",
        explanation: "No contradictions found.",
      },
    ]);

    expect(parsed[0]?.contradicts_ids).toEqual([]);
    expect(parsed[1]?.linked_ids).toEqual([]);
    expect(parsed[1]?.contradicts_ids).toEqual([]);
  });

  it("defaults missing wiki operation payload fields to empty strings", () => {
    const parsed = WikiOperationSchema.parse([
      {
        action: "create",
        type: "entity",
        slug: "obsidian",
        title: "Obsidian",
      },
      {
        action: "update",
        type: "procedure",
      },
    ]);

    expect(parsed[0]?.content).toBe("");
    expect(parsed[0]?.reason).toBe("");
    expect(parsed[1]?.slug).toBe("");
    expect(parsed[1]?.title).toBe("");
    expect(parsed[1]?.content).toBe("");
    expect(parsed[1]?.reason).toBe("");
  });

  it("recovers when extraction puts verification status in the layer field", () => {
    const parsed = RawMemorySchema.parse([
      {
        layer: "verified",
        title: "Boot pool health restored",
        summary: "The repair completed and verification showed a healthy boot pool.",
        details: "The session verified the boot pool with a successful scrub and dismissed the stale alert.",
        tags: ["truenas", "boot-pool"],
        salience: 0.9,
      },
    ]);

    expect(parsed[0]?.layer).toBe("semantic");
    expect(parsed[0]?.status).toBe("verified");
  });
});
