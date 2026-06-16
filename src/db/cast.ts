/**
 * Type helpers for SQLite query bindings.
 *
 * bun:sqlite's types are strict — `unknown[]` doesn't auto-cast to `SQLQueryBindings[]`.
 * This helper provides a single place to coerce arrays to the expected type.
 *
 * @module boltstore/db/cast
 */

import type { SQLQueryBindings } from "bun:sqlite";

/**
 * Cast a value to the `SQLQueryBindings` array type expected by bun:sqlite.
 * All values are passed as-is — the underlying database driver handles type coercion.
 */
export function toBindings(values: unknown[]): SQLQueryBindings[] {
  return values as SQLQueryBindings[];
}