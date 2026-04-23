import { watch, type FSWatcher } from "fs";
import { loadConfig } from "../config";

export type FileChangeHandler = (path: string) => void;

export class DebouncedWatcher {
  private watchers: FSWatcher[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private debounceMs = loadConfig().watchDebounceMs) {}

  watch(dir: string, handler: FileChangeHandler) {
    try {
      const watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const fullPath = `${dir}/${filename}`;
        // Debounce: only fire after file is stable
        const existing = this.timers.get(fullPath);
        if (existing) clearTimeout(existing);
        this.timers.set(
          fullPath,
          setTimeout(() => {
            this.timers.delete(fullPath);
            handler(fullPath);
          }, this.debounceMs),
        );
      });
      this.watchers.push(watcher);
    } catch (err) {
      console.error(`[watcher] Cannot watch ${dir}:`, err);
    }
  }

  close() {
    for (const w of this.watchers) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    this.watchers = [];
    this.timers.clear();
  }
}
