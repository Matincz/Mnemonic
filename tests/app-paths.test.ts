import { describe, expect, it } from "bun:test";

describe("app paths", () => {
  it("resolves macOS Mnemonic directories", async () => {
    const { resolveAppPaths } = await import("../src/app-paths");

    const paths = resolveAppPaths({
      platform: "darwin",
      homeDir: "/Users/tester",
      env: {},
    });

    expect(paths.appName).toBe("Mnemonic");
    expect(paths.dataRoot).toBe("/Users/tester/Library/Application Support/Mnemonic");
    expect(paths.configRoot).toBe("/Users/tester/Library/Preferences/Mnemonic");
    expect(paths.sqlitePath).toBe("/Users/tester/Library/Application Support/Mnemonic/data/memory.db");
    expect(paths.vaultPath).toBe("/Users/tester/Library/Application Support/Mnemonic/vault");
    expect(paths.legacyRoot).toBe("/Users/tester/Desktop/Memory agent");
  });

  it("resolves Linux XDG Mnemonic directories", async () => {
    const { resolveAppPaths } = await import("../src/app-paths");

    const paths = resolveAppPaths({
      platform: "linux",
      homeDir: "/home/tester",
      env: {
        XDG_DATA_HOME: "/xdg/data",
        XDG_CONFIG_HOME: "/xdg/config",
      },
    });

    expect(paths.dataRoot).toBe("/xdg/data/mnemonic");
    expect(paths.configRoot).toBe("/xdg/config/mnemonic");
    expect(paths.settingsPath).toBe("/xdg/config/mnemonic/settings.json");
  });
});
