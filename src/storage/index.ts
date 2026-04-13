// src/storage/index.ts
import { config } from "../config";
import { MemoryDB } from "./sqlite";
import { MarkdownVault } from "./markdown";
import { VectorStore } from "./vector";
import type { Memory, MemoryLayer } from "../types";

export class Storage {
  readonly db: MemoryDB;
  readonly vault: MarkdownVault;
  readonly vectors: VectorStore;

  constructor() {
    this.db = new MemoryDB(config.sqlitePath);
    this.vault = new MarkdownVault(config.vault);
    this.vectors = new VectorStore();
  }

  async init() {
    await this.vectors.init();
  }

  async saveMemory(mem: Memory, embedding?: number[]) {
    this.db.upsertMemory(mem);
    this.vault.writeMemory(mem);
    if (embedding) {
      await this.vectors.upsert(mem, embedding);
    }
  }

  getMemory(id: string) {
    return this.db.getMemory(id);
  }

  searchText(query: string, limit = 20) {
    return this.db.searchMemories(query, limit);
  }

  async searchSemantic(embedding: number[], limit = 10) {
    const vectorResults = await this.vectors.search(embedding, limit);
    return vectorResults
      .map((r) => {
        const mem = this.db.getMemory(r.id);
        return mem ? { ...mem, score: r.score } : null;
      })
      .filter(Boolean);
  }

  listByLayer(layer: MemoryLayer, limit = 50) {
    return this.db.listByLayer(layer, limit);
  }

  listRecent(limit = 50) {
    return this.db.listRecent(limit);
  }

  isProcessed(path: string, hash: string) {
    return this.db.isFileProcessed(path, hash);
  }

  markProcessed(path: string, hash: string, sessionId: string) {
    this.db.markFileProcessed(path, hash, sessionId);
  }

  rebuildIndex() {
    const all = this.db.listRecent(500);
    this.vault.rebuildIndex(all);
  }

  close() {
    this.db.close();
  }
}
