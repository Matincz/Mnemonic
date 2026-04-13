// src/storage/vector.ts
import * as lancedb from "@lancedb/lancedb";
import { config } from "../config";
import type { Memory } from "../types";

export class VectorStore {
  private db: Awaited<ReturnType<typeof lancedb.connect>> | null = null;
  private table: any = null;

  async init() {
    this.db = await lancedb.connect(config.lanceDir);
    try {
      this.table = await this.db.openTable("memories");
    } catch {
      // Table doesn't exist yet, will be created on first insert
    }
  }

  async upsert(mem: Memory, embedding: number[]) {
    const record = {
      id: mem.id,
      text: `${mem.title}\n${mem.summary}\n${mem.details}`,
      vector: embedding,
      layer: mem.layer,
      source: mem.sourceAgent,
      project: mem.project ?? "",
      salience: mem.salience,
      createdAt: mem.createdAt,
    };

    if (!this.table) {
      this.table = await this.db!.createTable("memories", [record]);
    } else {
      // Delete existing then insert (upsert pattern)
      try {
        await this.table.delete(`id = '${mem.id}'`);
      } catch {}
      await this.table.add([record]);
    }
  }

  async search(embedding: number[], limit = 10): Promise<Array<{ id: string; score: number }>> {
    if (!this.table) return [];
    const results = await this.table
      .vectorSearch(embedding)
      .limit(limit)
      .toArray();
    return results.map((r: any) => ({
      id: r.id,
      score: r._distance ?? 0,
    }));
  }

  async close() {
    // LanceDB doesn't require explicit close
  }
}
