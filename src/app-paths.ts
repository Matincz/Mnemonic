import { homedir, platform } from "os";
import { join } from "path";

export interface AppPathsInput {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export interface AppPaths {
  appName: "Mnemonic";
  dataRoot: string;
  configRoot: string;
  dataDir: string;
  vaultPath: string;
  sqlitePath: string;
  lanceDir: string;
  settingsPath: string;
  migrationMarkerPath: string;
  legacyRoot: string;
  legacyDataDir: string;
  legacyVaultPath: string;
  legacySettingsPath: string;
}

export function resolveAppPaths(input: AppPathsInput = {}): AppPaths {
  const currentPlatform = input.platform ?? platform();
  const homeDir = input.homeDir ?? homedir();
  const env = input.env ?? process.env;

  let dataRoot: string;
  let configRoot: string;

  if (currentPlatform === "darwin") {
    dataRoot = env.MNEMONIC_DATA_ROOT ?? join(homeDir, "Library", "Application Support", "Mnemonic");
    configRoot = env.MNEMONIC_CONFIG_ROOT ?? join(homeDir, "Library", "Preferences", "Mnemonic");
  } else if (currentPlatform === "win32") {
    dataRoot =
      env.MNEMONIC_DATA_ROOT ??
      (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Mnemonic") : join(homeDir, "AppData", "Local", "Mnemonic"));
    configRoot =
      env.MNEMONIC_CONFIG_ROOT ??
      (env.APPDATA ? join(env.APPDATA, "Mnemonic") : join(homeDir, "AppData", "Roaming", "Mnemonic"));
  } else {
    dataRoot = env.MNEMONIC_DATA_ROOT ?? join(env.XDG_DATA_HOME ?? join(homeDir, ".local", "share"), "mnemonic");
    configRoot = env.MNEMONIC_CONFIG_ROOT ?? join(env.XDG_CONFIG_HOME ?? join(homeDir, ".config"), "mnemonic");
  }

  const legacyRoot = env.MNEMONIC_LEGACY_ROOT ?? join(homeDir, "Desktop", "Memory agent");
  const dataDir = join(dataRoot, "data");

  return {
    appName: "Mnemonic",
    dataRoot,
    configRoot,
    dataDir,
    vaultPath: join(dataRoot, "vault"),
    sqlitePath: join(dataDir, "memory.db"),
    lanceDir: join(dataDir, "lance"),
    settingsPath: join(configRoot, "settings.json"),
    migrationMarkerPath: join(configRoot, ".migration-complete"),
    legacyRoot,
    legacyDataDir: join(legacyRoot, "data"),
    legacyVaultPath: join(legacyRoot, "vault"),
    legacySettingsPath: join(legacyRoot, "data", "settings.json"),
  };
}

let cachedPaths: AppPaths | null = null;

export function getAppPaths(): AppPaths {
  cachedPaths ??= resolveAppPaths();
  return cachedPaths;
}
