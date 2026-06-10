import { describe, expect, it } from "bun:test";
import { inferProjectFromText, normalizeProjectName } from "../../src/pipeline/project";

describe("project inference", () => {
  it("normalizes explicit workspace aliases", () => {
    expect(normalizeProjectName("workspace-iot")).toBe("iot");
  });

  it("infers project from session file paths", () => {
    expect(inferProjectFromText("Touched /Users/x/Desktop/Foo/src/index.ts during the fix")).toBe("Foo");
  });

  it("infers project from workspace and repository paths with normalized names", () => {
    expect(inferProjectFromText("cwd: /Users/x/Documents/Codex/2026-06-10/sub-store-workers")).toBe("sub-store-workers");
    expect(inferProjectFromText("git root: /Users/x/Projects/Mnemonic/.git")).toBe("Mnemonic");
  });

  it("normalizes path-like explicit projects to their repository basename", () => {
    expect(normalizeProjectName("/Users/x/Desktop/Mnemonic")).toBe("Mnemonic");
    expect(normalizeProjectName("/Users/x/Desktop/Mnemonic/.git")).toBe("Mnemonic");
  });

  it("falls back to general when no path or repo clue exists", () => {
    expect(inferProjectFromText("Discussed a general workflow without repository context")).toBe("general");
  });
});
