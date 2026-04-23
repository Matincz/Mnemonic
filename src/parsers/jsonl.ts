import { readFile } from "fs/promises";

export function parseJsonLines<T>(raw: string): T[] {
  const rows: T[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {}
  }

  return rows;
}

export async function readJsonLines<T>(filePath: string): Promise<T[]> {
  return parseJsonLines<T>(await readFile(filePath, "utf-8"));
}
