import { mkdirSync } from "fs";
import { createApp } from "./app";
import { WatcherOrchestrator } from "./watcher";
import { prepareRuntime } from "./migration";

export async function runDaemon() {
  prepareRuntime();
  console.log("Mnemonic starting...");

  const { config, storage, wiki, ipc } = createApp();

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.vault, { recursive: true });
  mkdirSync(config.ipcDir, { recursive: true });

  ipc.reset();
  ipc.writeStatus({ state: "starting", message: "Initializing storage and wiki." });

  await storage.init();
  console.log("✓ Storage initialized");
  console.log("✓ Wiki engine initialized");
  ipc.writeStatus({ state: "backfill", message: "Scanning historical sessions." });

  const watcher = new WatcherOrchestrator(storage, wiki, ipc);
  await watcher.backfillAll();
  console.log("✓ Historical session scan complete");

  watcher.start();
  console.log("✓ File watchers active");
  ipc.writeStatus({ state: "watching", message: "Watching for session updates." });

  let ampTimeout: ReturnType<typeof setTimeout> | undefined;
  let shuttingDown = false;

  const scheduleAmpPoll = async () => {
    if (shuttingDown) {
      return;
    }

    try {
      await watcher.pollAmp();
    } catch (err) {
      console.error("[amp-poll]", err);
    } finally {
      if (!shuttingDown) {
        ampTimeout = setTimeout(scheduleAmpPoll, 5 * 60 * 1000);
      }
    }
  };

  ampTimeout = setTimeout(scheduleAmpPoll, 5 * 60 * 1000);

  const shutdown = () => {
    shuttingDown = true;
    console.log("\nMnemonic shutting down...");
    if (ampTimeout) {
      clearTimeout(ampTimeout);
    }
    watcher.stop();
    storage.close();
    ipc.writeStatus({ state: "stopped", message: "Daemon stopped." });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("Mnemonic running. Press Ctrl+C to stop.");
}

if (import.meta.main) {
  runDaemon().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
