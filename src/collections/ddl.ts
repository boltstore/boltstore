/**
 * Collections (tables) management for Boltstore.
 *
 * Handles creating, listing, inspecting, updating, and deleting SQLite tables
 * via the REST API. All schema mutations go through the pool's write connection
 * and are wrapped in transactions.
 *
 * @module boltstore/collections
 */

import { DatabasePool } from "../db/pool";
import {
  type ColumnDefinition,
  SQLITE_TYPE_MAP,
  validateIdentifier,
  type ColumnType,
} from "@boltstore/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate the CREATE TABLE SQL for a set of column definitions.
 * System columns (id, created_at, updated_at) are always included.
 */
export function buildCreateTableSQL(name: string, columns: ColumnDefinition[]): string {
  const parts: string[] = [];

  // System columns
  parts.push("id TEXT PRIMARY KEY");
  parts.push("created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  parts.push("updated_at TEXT NOT NULL DEFAULT (datetime('now'))");

  // User-defined columns
  for (const col of columns) {
    validateIdentifier(col.name, "column name");
    const sqlType = SQLITE_TYPE_MAP[col.type];
    let def = `"${col.name}" ${sqlType}`;

    if (col.generated) {
      const kind = col.generated.stored ? "STORED" : "VIRTUAL";
      def += ` GENERATED ALWAYS AS (${col.generated.expression}) ${kind}`;
    } else {
      if (col.required) def += " NOT NULL";
      if (col.defaultExpr !== undefined) {
        def += ` DEFAULT (${col.defaultExpr})`;
      } else if (col.default !== undefined) {
        const dv = col.default;
        if (dv === null) def += " DEFAULT NULL";
        else if (typeof dv === "string") def += ` DEFAULT '${dv.replace(/'/g, "''")}'`;
        else if (typeof dv === "boolean") def += ` DEFAULT ${dv ? 1 : 0}`;
        else def += ` DEFAULT ${dv}`;
      }
      if (col.unique) def += " UNIQUE";
    }
    parts.push(def);
  }

  return `CREATE TABLE "${name}" (\n  ${parts.join(",\n  ")}\n)`;
}

/**
 * Convert a PRAGMA table_info row into a ColumnDefinition.
 */
export function rowToColumnDef(row: Record<string, unknown>): ColumnDefinition {
  const name = String(row.name || "");
  const rawType = String(row.type || "").toUpperCase();
  const notNull = Boolean(row.notnull);
  const dflt = row.dflt_value;

  // Map SQLite type back to our ColumnType
  let type: ColumnType = "TEXT";
  if (rawType.includes("INT")) type = "INTEGER";
  else if (rawType.includes("REAL") || rawType.includes("FLOAT") || rawType.includes("DOUB")) type = "REAL";
  else if (rawType.includes("BLOB")) type = "BLOB";
  else if (rawType === "BOOLEAN") type = "BOOLEAN";
  else if (rawType === "DATETIME") type = "DATETIME";

  const def: ColumnDefinition = { name, type };
  if (notNull) def.required = true;
  if (dflt !== null && dflt !== undefined) def.default = dflt as string | number | boolean | null;

  return def;
}

/**
 * Check if a table exists in sqlite_master.
 */
export function tableExists(pool: DatabasePool, name: string): boolean {
  const db = pool.read();
  const row = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name);
  return row !== null;
}
