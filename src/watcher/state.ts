import { createHash } from "crypto";
import { readFileSync } from "fs";
import type { Storage } from "../storage";

export function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function shouldProcess(filePath: string, storage: Storage): boolean {
  try {
    const hash = fileHash(filePath);
    return !storage.isProcessed(filePath, hash);
  } catch {
    return false;
  }
}

export function markDone(filePath: string, sessionId: string, storage: Storage) {
  const hash = fileHash(filePath);
  storage.markProcessed(filePath, hash, sessionId);
}
