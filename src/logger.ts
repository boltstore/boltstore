/**
 * Structured JSON logger with levels, request ID tracing, and asynchronous batched flushing.
 *
 * Logs are buffered in memory and flushed asynchronously on a short interval or when the
 * buffer reaches a size threshold. This keeps the hot path non-blocking while still ensuring
 * logs are written in order within each flush.
 *
 * @module boltstore/logger
 */

import { openSync, writeSync, closeSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL = (Bun.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;

/** Output destination: "stderr" | "stdout" | a file path. */
const LOG_OUTPUT = Bun.env.LOG_OUTPUT || "stderr";

/** Log format: "json" or "human". Defaults to human for terminal output. */
const LOG_FORMAT = Bun.env.LOG_FORMAT || (LOG_OUTPUT === "stderr" || LOG_OUTPUT === "stdout" ? "human" : "json");

/** Maximum number of entries to buffer before flushing. */
const LOG_BUFFER_LIMIT = Math.max(1, Math.min(1000, parseInt(Bun.env.LOG_BUFFER_LIMIT || "100", 10) || 100));

/** Flush interval in milliseconds. */
const LOG_FLUSH_MS = Math.max(10, parseInt(Bun.env.LOG_FLUSH_MS || "100", 10) || 100);

/** Optional sampling rate (0-1) applied to info-level logs. Error/warn are always logged. */
const LOG_SAMPLE_RATE = Math.max(0, Math.min(1, parseFloat(Bun.env.LOG_SAMPLE_RATE || "1")));

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  request_id?: string;
  method?: string;
  path?: string;
  client_ip?: string;
  user_agent?: string;
  status?: number;
  duration_ms?: number;
  error?: string;
  [key: string]: unknown;
}

let requestCounter = 0;

/**
 * Generate a unique request ID for tracing.
 */
export function generateRequestId(): string {
  requestCounter++;
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  const rnd = Buffer.from(random).toString("base64url").replace(/=+$/, "");
  return `req-${Date.now()}-${requestCounter}-${rnd}`;
}

// ---------------------------------------------------------------------------
// Async batched log writer
// ---------------------------------------------------------------------------

let logBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushPromise: Promise<void> | null = null;

function shouldDrop(level: LogLevel): boolean {
  if (level === "error" || level === "warn") return false;
  if (level === "info" && LOG_SAMPLE_RATE >= 1) return false;
  if (level === "info" && Math.random() > LOG_SAMPLE_RATE) return true;
  return false;
}

function formatEntry(e: LogEntry): string {
  if (LOG_FORMAT === "json") {
    return JSON.stringify(e);
  }
  const ts = e.timestamp ? e.timestamp.slice(11, 19) : "";
  const method = e.method ? ` ${e.method}` : "";
  const path = e.path ? ` ${e.path}` : "";
  const status = e.status !== undefined ? ` → ${e.status}` : "";
  const dur = e.duration_ms !== undefined ? ` (${e.duration_ms}ms)` : "";
  const err = e.error ? ` ERROR: ${e.error}` : "";
  return `${ts} [${e.level.toUpperCase()}]${method}${path}${status}${dur}${err} — ${e.message}`;
}

function writeEntries(entries: LogEntry[]): void {
  if (entries.length === 0) return;
  const chunk = entries.map((e) => formatEntry(e)).join("\n") + "\n";
  try {
    if (LOG_OUTPUT === "stdout") {
      process.stdout.write(chunk);
    } else if (LOG_OUTPUT === "stderr") {
      process.stderr.write(chunk);
    } else {
      const fd = openSync(LOG_OUTPUT, "a");
      try {
        writeSync(fd, chunk);
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    // Logging failures must not break the request.
  }
}

async function flushLogs(): Promise<void> {
  if (flushPromise) return flushPromise;
  const batch = logBuffer;
  logBuffer = [];
  if (batch.length === 0) return;
  flushPromise = new Promise<void>((resolve) => {
    // Defer actual I/O to next microtask to avoid blocking the event loop.
    queueMicrotask(() => {
      writeEntries(batch);
      flushPromise = null;
      resolve();
    });
  });
  return flushPromise;
}

function scheduleFlush(): void {
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushLogs();
    }, LOG_FLUSH_MS);
    // Ensure the timer does not keep the process alive if it's the only remaining work.
    if (typeof flushTimer.unref === "function") flushTimer.unref();
  }
}

/**
 * Buffer a structured JSON log entry for asynchronous batched flushing.
 */
function writeLog(entry: LogEntry): void {
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[LOG_LEVEL]) {
    return;
  }
  if (shouldDrop(entry.level)) return;
  logBuffer.push(entry);
  if (logBuffer.length >= LOG_BUFFER_LIMIT) {
    flushLogs();
  } else {
    scheduleFlush();
  }
}

/** Force an immediate flush of all buffered logs. */
export function flushLogger(): Promise<void> {
  return flushLogs();
}

/** Stop the background flush timer. */
export function stopLogger(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export const logger = {
  debug(message: string, meta?: Partial<LogEntry>): void {
    writeLog({ level: "debug", message, timestamp: new Date().toISOString(), ...meta });
  },

  info(message: string, meta?: Partial<LogEntry>): void {
    writeLog({ level: "info", message, timestamp: new Date().toISOString(), ...meta });
  },

  warn(message: string, meta?: Partial<LogEntry>): void {
    writeLog({ level: "warn", message, timestamp: new Date().toISOString(), ...meta });
  },

  error(message: string, meta?: Partial<LogEntry>): void {
    writeLog({ level: "error", message, timestamp: new Date().toISOString(), ...meta });
  },
};

export default logger;