import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  component?: string;
  logsDir?: string;
  level?: LogLevel;
  console?: boolean;
  retentionDays?: number;
  dateProvider?: () => Date;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(component: string): Logger;
}

type StructuredLogKind = "llm" | "pipeline";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let configured = false;
let options: Required<Omit<LoggerOptions, "component">> = {
  logsDir: "",
  level: "info",
  console: true,
  retentionDays: 7,
  dateProvider: () => new Date(),
};
let currentDate = "";
let fileWritable = true;

export function configureLogger(opts: LoggerOptions): void {
  const cfg = loadConfig();
  options = {
    logsDir: (opts.logsDir ?? options.logsDir) || cfg.logsDir,
    level: opts.level ?? options.level ?? cfg.logLevel,
    console: opts.console ?? options.console ?? cfg.logConsole,
    retentionDays: opts.retentionDays ?? options.retentionDays ?? cfg.logRetentionDays,
    dateProvider: opts.dateProvider ?? options.dateProvider,
  };
  configured = true;
  currentDate = localDate(options.dateProvider());
  fileWritable = ensureLogsDir();
  purgeOldLogs();
}

export function getLogger(component?: string): Logger {
  ensureConfigured();
  return new FileLogger(component);
}

export function flushLogger(): void {}

export function purgeOldLogs(): void {
  ensureConfigured();
  if (!fileWritable) {
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(options.logsDir);
  } catch {
    fileWritable = false;
    return;
  }

  const cutoff = retentionCutoff(localDate(options.dateProvider()), options.retentionDays);
  for (const entry of entries) {
    if (!/^(mnemonic|llm|pipeline)-\d{4}-\d{2}-\d{2}\.(log|ndjson)$/.test(entry)) {
      continue;
    }
    const match = entry.match(/(\d{4}-\d{2}-\d{2})/);
    if (match?.[1] && match[1] < cutoff) {
      rmSync(join(options.logsDir, entry), { force: true });
    }
  }
}

export function appendStructuredLog(kind: StructuredLogKind, record: Record<string, unknown>): void {
  ensureConfigured();
  rotateIfNeeded();
  if (!fileWritable) {
    return;
  }
  try {
    appendFileSync(join(options.logsDir, `${kind}-${currentDate}.ndjson`), `${JSON.stringify(record)}\n`);
  } catch {
    fileWritable = false;
  }
}

function ensureConfigured() {
  if (!configured) {
    const cfg = loadConfig();
    configureLogger({
      logsDir: cfg.logsDir,
      level: cfg.logLevel,
      console: cfg.logConsole,
      retentionDays: cfg.logRetentionDays,
    });
  }
}

class FileLogger implements Logger {
  constructor(private component?: string) {}

  debug(msg: string, meta?: Record<string, unknown>) {
    this.write("debug", msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>) {
    this.write("info", msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>) {
    this.write("warn", msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>) {
    this.write("error", msg, meta);
  }

  child(component: string): Logger {
    return new FileLogger(this.component ? `${this.component}.${component}` : component);
  }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    ensureConfigured();
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) {
      return;
    }

    rotateIfNeeded();
    const line = formatLine(options.dateProvider(), level, this.component, msg, meta);
    if (fileWritable) {
      try {
        appendFileSync(join(options.logsDir, `mnemonic-${currentDate}.log`), `${line}\n`);
      } catch {
        fileWritable = false;
      }
    }
    if (options.console) {
      const target = level === "warn" || level === "error" ? process.stderr : process.stdout;
      target.write(`${line}\n`);
    }
  }
}

function rotateIfNeeded() {
  const nextDate = localDate(options.dateProvider());
  if (nextDate !== currentDate) {
    currentDate = nextDate;
    fileWritable = ensureLogsDir();
    purgeOldLogs();
  }
}

function ensureLogsDir() {
  try {
    mkdirSync(options.logsDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function formatLine(date: Date, level: LogLevel, component: string | undefined, msg: string, meta?: Record<string, unknown>) {
  const parts = [date.toISOString(), level.toUpperCase()];
  if (component) {
    parts.push(`[${component}]`);
  }
  parts.push(msg);
  const renderedMeta = formatMeta(meta);
  return renderedMeta ? `${parts.join(" ")} | ${renderedMeta}` : parts.join(" ");
}

function formatMeta(meta?: Record<string, unknown>) {
  if (!meta) {
    return "";
  }
  return Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatMetaValue(value)}`)
    .join(" ");
}

function formatMetaValue(value: unknown): string {
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function retentionCutoff(today: string, retentionDays: number) {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() - retentionDays + 1);
  return localDate(date);
}
