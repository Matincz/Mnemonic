import { mkdirSync } from "fs";
import { config } from "./config";
import { Storage } from "./storage";
import { WatcherOrchestrator } from "./watcher";
import { prepareRuntime } from "./migration";

export async function runDaemon() {
  prepareRuntime();
  console.log("Mnemonic starting...");

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.vault, { recursive: true });

  const storage = new Storage();
  await storage.init();
  console.log("✓ Storage initialized");

  const watcher = new WatcherOrchestrator(storage);
  watcher.start();
  console.log("✓ File watchers active");

  const ampInterval = setInterval(() => {
    watcher.pollAmp().catch((err) => console.error("[amp-poll]", err));
  }, 5 * 60 * 1000);

  watcher.pollAmp().catch((err) => console.error("[amp-poll]", err));

  const shutdown = () => {
    console.log("\nMnemonic shutting down...");
    clearInterval(ampInterval);
    watcher.stop();
    storage.close();
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
