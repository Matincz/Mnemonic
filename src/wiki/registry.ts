// src/wiki/registry.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

interface RegistryEntry {
  canonical: string;
  aliases: string[];
  type: string;
  slug: string;
}

export class EntityRegistry {
  private entries: RegistryEntry[] = [];
  private filePath: string;

  constructor(wikiRoot: string) {
    mkdirSync(wikiRoot, { recursive: true });
    this.filePath = join(wikiRoot, "registry.json");
    this.load();
  }

  private load() {
    if (existsSync(this.filePath)) {
      this.entries = JSON.parse(readFileSync(this.filePath, "utf8"));
    }
  }

  private save() {
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2) + "\n");
  }

  register(canonical: string, type: string, slug: string, aliases: string[] = []) {
    const existing = this.find(canonical);
    if (existing) {
      for (const alias of aliases) {
        if (!existing.aliases.includes(alias)) {
          existing.aliases.push(alias);
        }
      }
      this.save();
      return existing;
    }
    const entry: RegistryEntry = { canonical, aliases, type, slug };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  find(name: string): RegistryEntry | undefined {
    const lower = name.toLowerCase();
    return this.entries.find(
      (e) =>
        e.canonical.toLowerCase() === lower ||
        e.aliases.some((a) => a.toLowerCase() === lower),
    );
  }

  findBySlug(slug: string): RegistryEntry | undefined {
    return this.entries.find((e) => e.slug === slug);
  }

  all(): RegistryEntry[] {
    return [...this.entries];
  }
}
