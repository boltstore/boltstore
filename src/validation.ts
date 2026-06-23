import { errorResponse } from "./server";

export const VALID_DB_NAME = /^[a-z0-9][a-z0-9_-]*$/;
export const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export const MAX_RECORD_LIMIT = 1000;
export const DEFAULT_RECORD_LIMIT = 50;

export function isValidDbName(name: string): boolean {
  return typeof name === "string" && VALID_DB_NAME.test(name);
}

export function isValidIdentifier(name: string): boolean {
  return typeof name === "string" && VALID_IDENTIFIER.test(name);
}

export function validateDbName(name: string): Response | null {
  if (!isValidDbName(name)) {
    return errorResponse(
      "VALIDATION",
      "Invalid database name. Use only lowercase letters, numbers, hyphens, and underscores, starting with a letter or number.",
      400,
    );
  }
  return null;
}

export function validateIdentifier(name: string, kind: "table" | "column"): Response | null {
  if (!isValidIdentifier(name)) {
    return errorResponse(
      "VALIDATION",
      `Invalid ${kind} name: "${name}". Use only letters, numbers, and underscores, starting with a letter or underscore (max 64 chars).`,
      400,
    );
  }
  return null;
}

export function validateIdentifiers(names: string[], kind: "table" | "column"): Response | null {
  for (const name of names) {
    const err = validateIdentifier(name, kind);
    if (err) return err;
  }
  return null;
}

const SAFE_DEFAULT_PATTERN = /^[\w\s\-+.:@/]*$/;
const DEFAULT_FORBIDDEN = /(;|--|\/\*|\*\/|'(?=(.*'.*'.*)))/;

export function validateColumnDefault(value: string): Response | null {
  if (typeof value !== "string") return null;
  if (DEFAULT_FORBIDDEN.test(value)) {
    return errorResponse(
      "VALIDATION",
      `Invalid column default value: contains forbidden characters (;, --, /*, */).`,
      400,
    );
  }
  return null;
}