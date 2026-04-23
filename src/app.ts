import { loadConfig, type Config } from "./config";
import { Storage } from "./storage";
import { WikiEngine } from "./wiki/engine";
import { IndexManager } from "./wiki/index-manager";
import { WikiLog } from "./wiki/log";
import { EntityRegistry } from "./wiki/registry";
import { RuntimeIPC } from "./ipc/runtime";
import type { WikiDeps } from "./pipeline";

export interface AppContext {
  config: Config;
  storage: Storage;
  wiki: WikiDeps;
  ipc: RuntimeIPC;
}

export function createApp(overrides: Partial<Config> = {}): AppContext {
  const config = loadConfig({ overrides });
  const storage = new Storage({
    config,
    dbPath: config.sqlitePath,
    vaultPath: config.vault,
  });
  const engine = new WikiEngine(config.vault);
  const index = new IndexManager(config.vault, engine);
  const log = new WikiLog(config.vault);
  const registry = new EntityRegistry(config.vault);
  const ipc = new RuntimeIPC(config.ipcStatusPath, config.ipcEventsPath, config.ipcDir);

  return {
    config,
    storage,
    wiki: { engine, index, log, registry },
    ipc,
  };
}
