import { mkdirSync } from "fs";
import { config } from "./config";
import { Storage } from "./storage";
import { WatcherOrchestrator } from "./watcher";

async function main() {
  console.log("🧠 Memory Agent starting...");

  // Ensure data directories exist
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.vault, { recursive: true });

  // Initialize storage
  const storage = new Storage();
  await storage.init();
  console.log("✓ Storage initialized");

  // Start watcher
  const watcher = new WatcherOrchestrator(storage);
  watcher.start();
  console.log("✓ File watchers active");

  // Poll Amp threads every 5 minutes
  const ampInterval = setInterval(() => {
    watcher.pollAmp().catch((err) => console.error("[amp-poll]", err));
  }, 5 * 60 * 1000);

  // Initial Amp poll
  watcher.pollAmp().catch((err) => console.error("[amp-poll]", err));

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n🧠 Shutting down...");
    clearInterval(ampInterval);
    watcher.stop();
    storage.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("🧠 Memory Agent running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
