// src/tui/hooks/use-memory.ts
import { useState, useEffect } from "react";
import { MemoryDB } from "../../storage/sqlite";
import { config } from "../../config";
import type { Memory, MemoryLayer, MemorySearchResult } from "../../types";
import { Storage } from "../../storage";
import { RuntimeIPC, type RuntimeEvent, type RuntimeStatus } from "../../ipc/runtime";

let db: MemoryDB | null = null;
let storage: Storage | null = null;
const ipc = new RuntimeIPC();

function getDB(): MemoryDB {
  if (!db) db = new MemoryDB(config.sqlitePath);
  return db;
}

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

export function useRecentMemories(limit = 30) {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    const load = () => setMemories(getDB().listRecent(limit));
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [limit]);
  return memories;
}

export function useSearchMemories(query: string) {
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    getStorage()
      .search(query, 12)
      .then((next) => {
        if (!cancelled) {
          setResults(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query]);
  return { results, loading };
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
  storage?.close();
  storage = null;
}

export function useRuntimeStatus() {
  const [status, setStatus] = useState<RuntimeStatus>(ipc.readStatus());
  const [events, setEvents] = useState<RuntimeEvent[]>(ipc.readRecentEvents(8));

  useEffect(() => {
    const load = () => {
      setStatus(ipc.readStatus());
      setEvents(ipc.readRecentEvents(8));
    };

    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, []);

  return { status, events };
}
