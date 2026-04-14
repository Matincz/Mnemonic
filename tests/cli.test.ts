import { describe, expect, it } from "bun:test";

describe("cli parsing", () => {
  it("parses openai browser auth command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["auth", "openai", "browser"])).toEqual({
      name: "auth-openai-browser",
    });
  });

  it("parses auth status command", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["auth", "status"])).toEqual({
      name: "auth-status",
    });
  });

  it("defaults to help for unknown commands", async () => {
    const { parseCliArgs } = await import("../src/cli");

    expect(parseCliArgs(["wat"])).toEqual({
      name: "help",
    });
  });
});
