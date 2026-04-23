import type { Memory, MemoryLayer } from "../types";

export interface SqlMemoryRow {
  id: string;
  layer: MemoryLayer;
  title: string;
  summary: string;
  details: string;
  tags: string;
  project: string | null;
  source_session_id: string;
  source_agent: Memory["sourceAgent"];
  created_at: string;
  updated_at: string;
  status: string;
  source_session_ids: string;
  supporting_memory_ids: string;
  salience: number;
  linked_memory_ids: string;
  contradicts: string;
}

export function rowToMemory(row: SqlMemoryRow): Memory {
  return {
    id: row.id,
    layer: row.layer,
    title: row.title,
    summary: row.summary,
    details: row.details,
    tags: JSON.parse(row.tags) as string[],
    project: row.project ?? undefined,
    sourceSessionId: row.source_session_id,
    sourceAgent: row.source_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    status: (row.status || "observed") as Memory["status"],
    sourceSessionIds: JSON.parse(row.source_session_ids || "[]") as string[],
    supportingMemoryIds: JSON.parse(row.supporting_memory_ids || "[]") as string[],
    salience: row.salience,
    linkedMemoryIds: JSON.parse(row.linked_memory_ids) as string[],
    contradicts: JSON.parse(row.contradicts) as string[],
  };
}
