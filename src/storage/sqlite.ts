// src/storage/sqlite.ts
import { Database } from "bun:sqlite";
import type { Memory, MemoryLayer } from "../types";

export class MemoryDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT,
        source_session_id TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        salience REAL NOT NULL DEFAULT 0.5,
        linked_memory_ids TEXT NOT NULL DEFAULT '[]',
        contradicts TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS processed_files (
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT NOT NULL,
        PRIMARY KEY (path, hash)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_agent);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_salience ON memories(salience DESC);
    `);
  }

  upsertMemory(mem: Memory) {
    this.db.prepare(`
      INSERT OR REPLACE INTO memories
      (id, layer, title, summary, details, tags, project,
       source_session_id, source_agent, created_at, salience,
       linked_memory_ids, contradicts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mem.id, mem.layer, mem.title, mem.summary, mem.details,
      JSON.stringify(mem.tags), mem.project ?? null,
      mem.sourceSessionId, mem.sourceAgent, mem.createdAt, mem.salience,
      JSON.stringify(mem.linkedMemoryIds), JSON.stringify(mem.contradicts)
    );
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    return row ? this.rowToMemory(row) : null;
  }

  searchMemories(query: string, limit = 20): Memory[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE title LIKE ? OR summary LIKE ? OR details LIKE ?
      ORDER BY salience DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  listByLayer(layer: MemoryLayer, limit = 50): Memory[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories WHERE layer = ? ORDER BY created_at DESC LIMIT ?"
    ).all(layer, limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  listRecent(limit = 50): Memory[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  markFileProcessed(path: string, hash: string, sessionId: string) {
    this.db.prepare(
      "INSERT OR REPLACE INTO processed_files (path, hash, session_id) VALUES (?, ?, ?)"
    ).run(path, hash, sessionId);
  }

  isFileProcessed(path: string, hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM processed_files WHERE path = ? AND hash = ?"
    ).get(path, hash);
    return !!row;
  }

  close() {
    this.db.close();
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      layer: row.layer,
      title: row.title,
      summary: row.summary,
      details: row.details,
      tags: JSON.parse(row.tags),
      project: row.project ?? undefined,
      sourceSessionId: row.source_session_id,
      sourceAgent: row.source_agent,
      createdAt: row.created_at,
      salience: row.salience,
      linkedMemoryIds: JSON.parse(row.linked_memory_ids),
      contradicts: JSON.parse(row.contradicts),
    };
  }
}
