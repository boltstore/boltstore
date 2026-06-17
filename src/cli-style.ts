/**
 * CLI output styling with a color-coded [⚡ boltstore] prefix.
 * The prefix color indicates the message type; the message text is always plain.
 *
 * @module boltstore/cli-style
 */

/** ANSI escape codes for terminal colors. */
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
} as const;

function prefix(color: string): string {
  return `${color}[${COLORS.bold}⚡${COLORS.reset}${color} boltstore]${COLORS.reset}`;
}

/** Informational message (bold ⚡, default color). */
export function info(msg: string): void {
  console.log(`${prefix(COLORS.reset)} ${msg}`);
}

/** Success message (green prefix). */
export function success(msg: string): void {
  console.log(`${prefix(COLORS.green)} ${msg}`);
}

/** Warning message (yellow prefix). */
export function warn(msg: string): void {
  console.warn(`${prefix(COLORS.yellow)} ${msg}`);
}

/** Error message (red prefix, to stderr). */
export function error(msg: string): void {
  console.error(`${prefix(COLORS.red)} ${msg}`);
}

/** Plain output without the prefix (data, JSON, etc.). */
export function out(msg: string): void {
  console.log(msg);
}