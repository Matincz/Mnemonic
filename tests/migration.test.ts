import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("legacy migration", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mnemonic-migrate-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("copies legacy data into the new Mnemonic directories", async () => {
    const { migrateLegacyData } = await import("../src/migration");

    const legacyRoot = join(root, "legacy");
    const legacyDataDir = join(legacyRoot, "data");
    const legacyVaultPath = join(legacyRoot, "vault");
    mkdirSync(legacyDataDir, { recursive: true });
    mkdirSync(join(legacyVaultPath, "episodic"), { recursive: true });
    writeFileSync(join(legacyDataDir, "memory.db"), "sqlite");
    writeFileSync(join(legacyDataDir, "settings.json"), JSON.stringify({ apiKey: "sk-test" }));
    writeFileSync(join(legacyVaultPath, "episodic", "mem.md"), "# mem");

    const paths = {
      appName: "Mnemonic" as const,
      dataRoot: join(root, "new-data-root"),
      configRoot: join(root, "new-config-root"),
      dataDir: join(root, "new-data-root", "data"),
      vaultPath: join(root, "new-data-root", "vault"),
      sqlitePath: join(root, "new-data-root", "data", "memory.db"),
      lanceDir: join(root, "new-data-root", "data", "lance"),
      settingsPath: join(root, "new-config-root", "settings.json"),
      migrationMarkerPath: join(root, "new-config-root", ".migration-complete"),
      legacyRoot,
      legacyDataDir,
      legacyVaultPath,
      legacySettingsPath: join(legacyDataDir, "settings.json"),
    };

    const result = migrateLegacyData(paths);

    expect(result.migrated).toBe(true);
    expect(existsSync(paths.sqlitePath)).toBe(true);
    expect(existsSync(join(paths.vaultPath, "episodic", "mem.md"))).toBe(true);
    expect(existsSync(paths.settingsPath)).toBe(true);
    expect(existsSync(paths.migrationMarkerPath)).toBe(true);
    expect(JSON.parse(readFileSync(paths.settingsPath, "utf-8")).apiKey).toBe("sk-test");
  });

  it("does not overwrite an existing new installation", async () => {
    const { migrateLegacyData } = await import("../src/migration");

    const legacyRoot = join(root, "legacy");
    const legacyDataDir = join(legacyRoot, "data");
    const legacyVaultPath = join(legacyRoot, "vault");
    mkdirSync(legacyDataDir, { recursive: true });
    mkdirSync(legacyVaultPath, { recursive: true });
    writeFileSync(join(legacyDataDir, "memory.db"), "old");

    const dataRoot = join(root, "new-data-root");
    const configRoot = join(root, "new-config-root");
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    writeFileSync(join(dataRoot, "data", "memory.db"), "new");

    const paths = {
      appName: "Mnemonic" as const,
      dataRoot,
      configRoot,
      dataDir: join(dataRoot, "data"),
      vaultPath: join(dataRoot, "vault"),
      sqlitePath: join(dataRoot, "data", "memory.db"),
      lanceDir: join(dataRoot, "data", "lance"),
      settingsPath: join(configRoot, "settings.json"),
      migrationMarkerPath: join(configRoot, ".migration-complete"),
      legacyRoot,
      legacyDataDir,
      legacyVaultPath,
      legacySettingsPath: join(legacyDataDir, "settings.json"),
    };

    const result = migrateLegacyData(paths);

    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("target-not-empty");
    expect(readFileSync(paths.sqlitePath, "utf-8")).toBe("new");
  });
});
