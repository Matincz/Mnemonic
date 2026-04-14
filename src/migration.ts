import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getAppPaths, type AppPaths } from "./app-paths";

export interface MigrationResult {
  migrated: boolean;
  reason: "migrated" | "no-legacy-data" | "already-migrated" | "target-not-empty";
}

function dirHasContent(path: string): boolean {
  return existsSync(path) && readdirSync(path).length > 0;
}

function targetHasContent(paths: AppPaths): boolean {
  return dirHasContent(paths.dataRoot) || dirHasContent(paths.configRoot);
}

function copyIfExists(source: string, target: string) {
  if (!existsSync(source)) return;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

export function migrateLegacyData(paths: AppPaths): MigrationResult {
  if (existsSync(paths.migrationMarkerPath)) {
    return { migrated: false, reason: "already-migrated" };
  }

  const hasLegacyData =
    existsSync(paths.legacyDataDir) || existsSync(paths.legacyVaultPath) || existsSync(paths.legacySettingsPath);
  if (!hasLegacyData) {
    return { migrated: false, reason: "no-legacy-data" };
  }

  if (targetHasContent(paths)) {
    return { migrated: false, reason: "target-not-empty" };
  }

  mkdirSync(paths.dataRoot, { recursive: true });
  mkdirSync(paths.configRoot, { recursive: true });

  copyIfExists(paths.legacyDataDir, paths.dataDir);
  copyIfExists(paths.legacyVaultPath, paths.vaultPath);
  copyIfExists(paths.legacySettingsPath, paths.settingsPath);

  writeFileSync(
    paths.migrationMarkerPath,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        from: paths.legacyRoot,
      },
      null,
      2,
    ),
  );

  return { migrated: true, reason: "migrated" };
}

export function prepareRuntime(): MigrationResult {
  return migrateLegacyData(getAppPaths());
}
