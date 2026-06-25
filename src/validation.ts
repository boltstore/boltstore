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

const LITERAL_DEFAULT = /^(?:[-+]?\d+\.?\d*|'[^']*'|NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i;

export function validateColumnDefault(value: string): Response | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return errorResponse("VALIDATION", "Column default must be a string.", 400);
  }
  if (!LITERAL_DEFAULT.test(value)) {
    return errorResponse(
      "VALIDATION",
      `Invalid column default: "${value}". Must be a literal (number, quoted string, NULL, TRUE, FALSE, or CURRENT_TIMESTAMP).`,
      400,
    );
  }
  return null;
}