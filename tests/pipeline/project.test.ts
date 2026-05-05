import { describe, expect, it } from "bun:test";
import { inferProjectFromText, normalizeProjectName } from "../../src/pipeline/project";

describe("project inference", () => {
  it("normalizes explicit workspace aliases", () => {
    expect(normalizeProjectName("workspace-iot")).toBe("iot");
  });

  it("infers project from session file paths", () => {
    expect(inferProjectFromText("Touched /Users/x/Desktop/Foo/src/index.ts during the fix")).toBe("Foo");
  });

  it("falls back to general when no path or repo clue exists", () => {
    expect(inferProjectFromText("Discussed a general workflow without repository context")).toBe("general");
  });
});
