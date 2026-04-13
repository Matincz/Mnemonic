// src/tui/hooks/use-memory.ts
import { useState, useEffect } from "react";
import { MemoryDB } from "../../storage/sqlite";
import { config } from "../../config";
import type { Memory, MemoryLayer } from "../../types";

let db: MemoryDB | null = null;

function getDB(): MemoryDB {
  if (!db) db = new MemoryDB(config.sqlitePath);
  return db;
}

export function useRecentMemories(limit = 30) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    setMemories(getDB().listRecent(limit));
  }, [limit]);
  return memories;
}

export function useSearchMemories(query: string) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    if (query.length >= 2) {
      setMemories(getDB().searchMemories(query));
    } else {
      setMemories([]);
    }
  }, [query]);
  return memories;
}

export function useLayerMemories(layer: MemoryLayer) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    setMemories(getDB().listByLayer(layer));
  }, [layer]);
  return memories;
}

export function cleanupDB() {
  db?.close();
  db = null;
}
