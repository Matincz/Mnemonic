import { mkdirSync } from "fs";
import { createApp } from "./app";
import { WatcherOrchestrator } from "./watcher";
import { prepareRuntime } from "./migration";
import { getLogger } from "./logger";

const logger = getLogger("bootstrap");

export async function runDaemon() {
  prepareRuntime();
  logger.info("Mnemonic starting...");

  const { config, storage, wiki, ipc } = createApp();

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.vault, { recursive: true });
  mkdirSync(config.ipcDir, { recursive: true });
  mkdirSync(config.logsDir, { recursive: true });

  ipc.reset();
  ipc.writeStatus({ state: "starting", message: "Initializing storage and wiki." });

  await storage.init();
  logger.info("Storage initialized");
  logger.info("Wiki engine initialized");
  ipc.writeStatus({ state: "backfill", message: "Scanning historical sessions." });

  const watcher = new WatcherOrchestrator(storage, wiki, ipc);
  await watcher.backfillAll();
  logger.info("Historical session scan complete");

  watcher.start();
  logger.info("File watchers active");
  ipc.writeStatus({ state: "watching", message: "Watching for session updates." });

  let ampTimeout: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let shuttingDown = false;

  const scheduleAmpPoll = async () => {
    if (shuttingDown) {
      return;
    }

    try {
      await watcher.pollAmp();
    } catch (err) {
      logger.error("Amp poll failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!shuttingDown) {
        ampTimeout = setTimeout(scheduleAmpPoll, 5 * 60 * 1000);
      }
    }
  };

  ampTimeout = setTimeout(scheduleAmpPoll, 5 * 60 * 1000);
  heartbeatInterval = setInterval(() => {
    ipc.heartbeat();
  }, 30 * 1000);

  const shutdown = () => {
    shuttingDown = true;
    logger.info("Mnemonic shutting down...");
    if (ampTimeout) {
      clearTimeout(ampTimeout);
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    watcher.stop();
    storage.close();
    ipc.writeStatus({ state: "stopped", message: "Daemon stopped." });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("Mnemonic running. Press Ctrl+C to stop.");
}

if (import.meta.main) {
  runDaemon().catch((err) => {
    logger.error("Fatal", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
