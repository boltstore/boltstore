/**
 * Structured JSON logger with levels and request ID tracing.
 *
 * @module boltstore/logger
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL = (Bun.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  request_id?: string;
  method?: string;
  path?: string;
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
  return `req-${Date.now()}-${requestCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Write a structured JSON log entry to stderr (leaves stdout clean for response data).
 */
function writeLog(entry: LogEntry): void {
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[LOG_LEVEL]) {
    return;
  }
  // Use stderr so stdout can be used for response data if needed
  Bun.stderr.write(JSON.stringify(entry) + "\n");
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