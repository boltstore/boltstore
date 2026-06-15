/**
 * Raw SQL query execution for admin users.
 *
 * Allows executing arbitrary SQL against a database with safety guards:
 * - Read-only queries via a separate endpoint
 * - Write queries with system table protection
 * - EXPLAIN QUERY PLAN for debugging
 * - All queries use parameterized prepared statements
 *
 * @module boltstore/admin/query
 */

import { DatabasePool } from "../db/pool";
import { validateIdentifier } from "@boltstore/utils";

/** System tables that must not be dropped or altered via raw SQL. */
const PROTECTED_TABLES = [
  "_collections",
  "_databases",
  "_migrations",
  "_users",
  "_tokens",
  "_api_keys",
  "_webhooks",
  "_jobs",
  "sqlite_master",
  "sqlite_sequence",
  "sqlite_stat1",
];

/** Destructive SQL patterns that are blocked. */
const BLOCKED_PATTERNS = [
  /\bDROP\s+TABLE\s+/i,
  /\bALTER\s+TABLE\s+/i,
  /\bDROP\s+INDEX\s+/i,
  /\bDROP\s+VIEW\s+/i,
  /\bDROP\s+TRIGGER\s+/i,
];

/**
 * Execute a read-only SQL query.
 *
 * Only SELECT, EXPLAIN, PRAGMA (read-only), and WITH (CTE) statements are allowed.
 *
 * `POST /api/admin/:database/query`
 */
export function executeReadQuery(
  pool: DatabasePool,
  sql: string,
  params: unknown[] = []
): { columns: string[]; rows: Record<string, unknown>[]; rowCount: number } {
  const trimmed = sql.trim().toUpperCase();

  // Allow SELECT, EXPLAIN, PRAGMA (read-only), and WITH (CTE)
  const isReadOnly =
    trimmed.startsWith("SELECT") ||
    trimmed.startsWith("EXPLAIN") ||
    trimmed.startsWith("PRAGMA") ||
    trimmed.startsWith("WITH") ||
    trimmed.startsWith("DESCRIBE");

  if (!isReadOnly) {
    throw Object.assign(
      new Error("Only SELECT, EXPLAIN, PRAGMA, WITH, and DESCRIBE queries are allowed on this endpoint. Use /api/admin/query/write for mutations."),
      { status: 400 }
    );
  }

  const db = pool.read();
  const rows = db.query(sql).all(...params) as Record<string, unknown>[];

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { columns, rows, rowCount: rows.length };
}

/**
 * Execute a write SQL query (INSERT, UPDATE, DELETE, CREATE, etc.).
 *
 * Destructive operations on system tables are blocked.
 *
 * `POST /api/admin/:database/query/write`
 */
export function executeWriteQuery(
  pool: DatabasePool,
  sql: string,
  params: unknown[] = []
): { changes: number; lastInsertRowid: number | bigint } {
  // Validate system table protection
  for (const pattern of BLOCKED_PATTERNS) {
    const match = sql.match(pattern);
    if (match) {
      const tableMatch = sql.match(
        /(?:DROP\s+TABLE|ALTER\s+TABLE|DROP\s+INDEX|DROP\s+VIEW|DROP\s+TRIGGER)\s+(?:IF\s+EXISTS\s+)?['"]?(\w+)['"]?/i
      );
      if (tableMatch) {
        const tableName = tableMatch[1].toLowerCase();
        if (PROTECTED_TABLES.includes(tableName) || tableName.startsWith("sqlite_") || tableName.startsWith("_")) {
          throw Object.assign(
            new Error(`Cannot perform destructive operation on system table "${tableName}".`),
            { status: 403 }
          );
        }
      }
    }
  }

  return pool.writeTransaction(() => {
    const db = pool.write();
    db.run(sql, params);

    // Use db.query() for SELECT-based introspection (run() doesn't support .values())
    const changesQuery = db.query("SELECT changes() as cnt").get() as { cnt: number } | null;
    const rowIdQuery = db.query("SELECT last_insert_rowid() as id").get() as { id: number } | null;

    return {
      changes: changesQuery?.cnt ?? 0,
      lastInsertRowid: rowIdQuery?.id ?? 0,
    };
  });
}

/**
 * Execute EXPLAIN QUERY PLAN on a SQL statement.
 *
 * Returns the query plan rows for debugging slow queries.
 *
 * `POST /api/admin/:database/query/explain`
 */
export function explainQuery(
  pool: DatabasePool,
  sql: string,
  params: unknown[] = []
): { rows: Record<string, unknown>[] } {
  const trimmed = sql.trim().toUpperCase();

  // EXPLAIN QUERY PLAN only works on SELECT, INSERT, UPDATE, DELETE
  if (trimmed.startsWith("EXPLAIN") || trimmed.startsWith("PRAGMA")) {
    throw Object.assign(
      new Error("Cannot explain an EXPLAIN or PRAGMA statement."),
      { status: 400 }
    );
  }

  const db = pool.read();
  const rows = db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Record<string, unknown>[];
  return { rows };
}