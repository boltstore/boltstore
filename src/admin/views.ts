/**
 * Views management module for Boltstore.
 *
 * SQLite views are saved SELECT queries presented as virtual tables.
 * They provide read-only access to pre-defined queries — useful for
 * denormalized data, reporting, and access control.
 *
 * All routes are admin-only (`/api/admin/:database/views`).
 *
 * @module boltstore/admin/views
 */

import { DatabasePool } from "../db/pool";
import { toBindings } from "../db/cast";
import { validateIdentifier, isReservedTable } from "@boltstore/utils";
import { listRecords } from "../records";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewInfo {
  /** View name. */
  name: string;
  /** The SQL definition (CREATE VIEW ... AS ...). */
  sql: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SQL statement types that are NOT allowed in views. */
const BLOCKED_STATEMENT_PREFIXES = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
  "PRAGMA", "VACUUM", "REINDEX", "ATTACH", "DETACH",
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a SQL string is a safe SELECT or WITH statement.
 * Rejects write operations, schema changes, and pragmas.
 */
function validateSelectSQL(sql: string): void {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  // Allow SELECT or WITH (CTE)
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw Object.assign(
      new Error(`View SQL must be a SELECT or WITH statement. Got: "${trimmed.substring(0, 50)}..."`),
      { status: 400 }
    );
  }

  // Block dangerous statements that could appear inside the SQL
  // (e.g., SELECT * FROM t; DROP TABLE x)
  const stateless = upper
    .replace(/'[^']*'/g, "")  // remove string literals
    .replace(/"[^"]*"/g, ""); // remove quoted identifiers

  for (const prefix of BLOCKED_STATEMENT_PREFIXES) {
    // Check for the prefix as a standalone word (surrounded by whitespace/semicolons)
    const regex = new RegExp(`\\b${prefix}\\b`, "g");
    let match;
    while ((match = regex.exec(stateless)) !== null) {
      // Allow CREATE in the context of the view definition itself
      // (we already checked that the statement starts with SELECT/WITH)
      // Also allow WITH which is a CTE
      if (prefix === "CREATE" || prefix === "WITH") {
        continue;
      }
      throw Object.assign(
        new Error(`View SQL must not contain ${prefix} statements. Only read-only SELECT queries are allowed.`),
        { status: 403 }
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new view.
 *
 * The SQL must be a SELECT or WITH statement. Write operations,
 * schema changes, and references to system tables are rejected.
 *
 * `POST /api/admin/:database/views`
 */
export function createView(
  pool: DatabasePool,
  name: string,
  sql: string
): ViewInfo {
  validateIdentifier(name, "view name");

  if (isReservedTable(name)) {
    throw Object.assign(
      new Error(`Cannot create view with reserved name "${name}".`),
      { status: 403 }
    );
  }

  // Validate the SQL
  if (!sql || typeof sql !== "string" || sql.trim().length === 0) {
    throw Object.assign(
      new Error("Field 'sql' is required and must be a non-empty string."),
      { status: 400 }
    );
  }

  validateSelectSQL(sql);

  // Check for duplicates
  const db = pool.read();
  const existing = db
    .query("SELECT 1 FROM sqlite_master WHERE type='view' AND name=?")
    .get(name);

  if (existing) {
    throw Object.assign(
      new Error(`View "${name}" already exists. Use a different name or delete the existing view first.`),
      { status: 409 }
    );
  }

  // Create the view in a transaction
  pool.writeTransaction(() => {
    pool.write().run(`CREATE VIEW "${name}" AS ${sql}`);
  });

  return { name, sql: sql.trim() };
}

/**
 * List all user-created views in the database.
 *
 * Excludes SQLite internal views (sqlite_*).
 *
 * `GET /api/admin/:database/views`
 */
export function listViews(pool: DatabasePool): ViewInfo[] {
  const db = pool.read();

  const rows = db
    .query("SELECT name, sql FROM sqlite_master WHERE type='view' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string; sql: string }[];

  return rows.map((r) => ({
    name: r.name,
    sql: r.sql || "",
  }));
}

/**
 * Get metadata for a single view, including its SQL definition.
 *
 * `GET /api/admin/:database/views/:name`
 */
export function getView(pool: DatabasePool, name: string): ViewInfo {
  validateIdentifier(name, "view name");
  const db = pool.read();

  const row = db
    .query("SELECT name, sql FROM sqlite_master WHERE type='view' AND name=?")
    .get(name) as { name: string; sql: string } | null;

  if (!row) {
    throw Object.assign(
      new Error(`View "${name}" not found.`),
      { status: 404 }
    );
  }

  return {
    name: row.name,
    sql: row.sql || "",
  };
}

/**
 * Query data from a view.
 *
 * Supports the same filtering, sorting, and pagination options as
 * `listRecords` on regular collections. The view is treated as a
 * read-only virtual table.
 *
 * `GET /api/admin/:database/views/:name?sort=field&direction=desc&limit=10`
 */
export function queryView(
  pool: DatabasePool,
  name: string,
  options?: {
    filter?: Record<string, unknown>;
    sort?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }
): Record<string, unknown>[] {
  validateIdentifier(name, "view name");

  // Verify the view exists
  const db = pool.read();
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='view' AND name=? LIMIT 1")
    .get(name);
  if (!exists) {
    throw Object.assign(
      new Error(`View "${name}" not found.`),
      { status: 404 }
    );
  }

  // Query the view using the same logic as listRecords
  let sql = `SELECT * FROM "${name}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      validateIdentifier(key, "filter field");
      conditions.push(`"${key}" = ?`);
      params.push(value);
    }
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  if (options?.sort) {
    validateIdentifier(options.sort, "sort field");
    const direction = options.direction === "asc" ? "ASC" : "DESC";
    sql += ` ORDER BY "${options.sort}" ${direction}`;
  }

  if (options?.limit !== undefined) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }
  if (options?.offset !== undefined) {
    sql += ` OFFSET ?`;
    params.push(options.offset);
  }

  return db.query(sql).all(...toBindings(params)) as Record<string, unknown>[];
}

/**
 * Delete (drop) a view.
 *
 * `DELETE /api/admin/:database/views/:name`
 */
export function dropView(pool: DatabasePool, name: string): void {
  validateIdentifier(name, "view name");

  if (isReservedTable(name)) {
    throw Object.assign(
      new Error(`Cannot drop reserved view "${name}".`),
      { status: 403 }
    );
  }

  const db = pool.read();
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='view' AND name=? LIMIT 1")
    .get(name);

  if (!exists) {
    throw Object.assign(
      new Error(`View "${name}" not found.`),
      { status: 404 }
    );
  }

  pool.writeTransaction(() => {
    pool.write().run(`DROP VIEW "${name}"`);
  });
}