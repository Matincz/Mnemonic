import { describe, expect, it } from "bun:test";
import { BatchLinkResultSchema, LinkResultSchema, WikiOperationSchema } from "../../src/llm/schemas";

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
});
