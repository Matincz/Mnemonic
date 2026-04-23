import { createHash } from "crypto";
import { readFileSync } from "fs";
import type { Storage } from "../storage";
import type { ParsedSession } from "../types";

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

export function sessionHash(session: ParsedSession): string {
  const normalized = JSON.stringify({
    id: session.id,
    source: session.source,
    timestamp: session.timestamp.toISOString(),
    project: session.project ?? "",
    rawPath: session.rawPath,
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp?.toISOString() ?? "",
    })),
  });

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
