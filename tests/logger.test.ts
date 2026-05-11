import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { configureLogger, getLogger, purgeOldLogs } from "../src/logger";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeLogsDir() {
  const dir = mkdtempSync(join(tmpdir(), "mnemonic-test-logs-"));
  tempDirs.push(dir);
  return dir;
}

describe("logger", () => {
  it("filters messages below the configured level", () => {
    const logsDir = makeLogsDir();
    configureLogger({
      logsDir,
      level: "info",
      console: false,
      retentionDays: 7,
      dateProvider: () => new Date("2026-05-11T12:00:00.000Z"),
    });

    const logger = getLogger("test");
    logger.debug("hidden");
    logger.info("visible");

    const output = readFileSync(join(logsDir, "mnemonic-2026-05-11.log"), "utf8");
    expect(output).not.toContain("hidden");
    expect(output).toContain("visible");
  });

  it("rotates file names when the local day changes", () => {
    const logsDir = makeLogsDir();
    let now = new Date("2026-05-11T23:59:00.000Z");
    configureLogger({
      logsDir,
      level: "debug",
      console: false,
      retentionDays: 7,
      dateProvider: () => now,
    });

    const logger = getLogger("rotate");
    logger.info("before");
    now = new Date("2026-05-12T00:01:00.000Z");
    logger.info("after");

    expect(readFileSync(join(logsDir, "mnemonic-2026-05-11.log"), "utf8")).toContain("before");
    expect(readFileSync(join(logsDir, "mnemonic-2026-05-12.log"), "utf8")).toContain("after");
  });

  it("purges mnemonic, llm, and pipeline logs older than the retention window", () => {
    const logsDir = makeLogsDir();
    configureLogger({
      logsDir,
      level: "debug",
      console: false,
      retentionDays: 7,
      dateProvider: () => new Date("2026-05-11T12:00:00.000Z"),
    });
    for (const prefix of ["mnemonic", "llm", "pipeline"]) {
      writeFileSync(join(logsDir, `${prefix}-2026-05-04.${prefix === "mnemonic" ? "log" : "ndjson"}`), "old\n");
      writeFileSync(join(logsDir, `${prefix}-2026-05-05.${prefix === "mnemonic" ? "log" : "ndjson"}`), "new\n");
    }

    purgeOldLogs();

    expect(existsSync(join(logsDir, "mnemonic-2026-05-04.log"))).toBe(false);
    expect(existsSync(join(logsDir, "llm-2026-05-04.ndjson"))).toBe(false);
    expect(existsSync(join(logsDir, "pipeline-2026-05-04.ndjson"))).toBe(false);
    expect(existsSync(join(logsDir, "mnemonic-2026-05-05.log"))).toBe(true);
    expect(existsSync(join(logsDir, "llm-2026-05-05.ndjson"))).toBe(true);
    expect(existsSync(join(logsDir, "pipeline-2026-05-05.ndjson"))).toBe(true);
  });

  it("serializes meta values predictably", () => {
    const logsDir = makeLogsDir();
    configureLogger({
      logsDir,
      level: "debug",
      console: false,
      retentionDays: 7,
      dateProvider: () => new Date("2026-05-11T12:00:00.000Z"),
    });

    getLogger("meta").info("message", {
      plain: "value",
      spaced: "two words",
      object: { nested: true },
    });

    const output = readFileSync(join(logsDir, "mnemonic-2026-05-11.log"), "utf8");
    expect(output).toContain("plain=value");
    expect(output).toContain('spaced="two words"');
    expect(output).toContain('object={"nested":true}');
  });

  it("child loggers append component names", () => {
    const logsDir = makeLogsDir();
    configureLogger({
      logsDir,
      level: "debug",
      console: false,
      retentionDays: 7,
      dateProvider: () => new Date("2026-05-11T12:00:00.000Z"),
    });

    getLogger("parent").child("child").info("nested");

    const output = readFileSync(join(logsDir, "mnemonic-2026-05-11.log"), "utf8");
    expect(output).toContain("[parent.child]");
  });

  it("does not mirror to stdout or stderr when console logging is disabled", () => {
    const logsDir = makeLogsDir();
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      configureLogger({
        logsDir,
        level: "debug",
        console: false,
        retentionDays: 7,
        dateProvider: () => new Date("2026-05-11T12:00:00.000Z"),
      });
      getLogger("quiet").error("silent console");
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    }

    expect(writes).toEqual([]);
  });
});
