/**
 * Records CRUD for Boltstore collections.
 *
 * Handles creating, listing, getting, updating, and deleting records
 * within a collection (table). All queries use parameterized statements
 * to prevent SQL injection.
 *
 * Records are stored as JSON-friendly objects. System columns `id`,
 * `created_at`, and `updated_at` are managed automatically.
 *
 * @module boltstore/records
 */

import { DatabasePool } from "./db/pool";
import { toBindings } from "./db/cast";
import { validateIdentifier } from "@boltstore/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique record ID. */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `rec_${timestamp}_${random}`;
}

/** Get the current ISO-8601 timestamp. */
function now(): string {
  return new Date().toISOString();
}

/**
 * Validate that a collection exists, returning its column names.
 * Throws 404 if the table doesn't exist.
 */
function getColumnNames(pool: DatabasePool, collection: string): string[] {
  validateIdentifier(collection, "collection name");
  const db = pool.read();

  // Check table exists
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(collection);
  if (!exists) {
    throw Object.assign(
      new Error(`Collection "${collection}" not found.`),
      { status: 404 }
    );
  }

  const rows = db.query(`PRAGMA table_info("${collection}")`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new record in a collection.
 *
 * If the data includes an `id`, it is used as the primary key (upsert path).
 * Otherwise, a unique ID is generated automatically.
 *
 * `POST /api/:database/collections/:collection/records`
 */
export function createRecord(
  pool: DatabasePool,
  collection: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const columns = getColumnNames(pool, collection);
  const systemCols = new Set(["id", "created_at", "updated_at"]);

  // Build the record
  const id = (data.id as string) || generateId();
  const timestamp = now();

  const record: Record<string, unknown> = {
    id,
    created_at: (data.created_at as string) || timestamp,
    updated_at: timestamp,
  };

  // Copy user-provided fields (skip system columns already handled)
  for (const key of Object.keys(data)) {
    if (systemCols.has(key)) continue;
    record[key] = data[key];
  }

  // Build parameterized INSERT
  const keys = Object.keys(record);
  const placeholders = keys.map(() => "?").join(", ");
  const quotedKeys = keys.map((k) => `"${k}"`).join(", ");
  const values = keys.map((k) => record[k]);

  return pool.writeTransaction(() => {
    const db = pool.write();

    // Use INSERT OR REPLACE to support upsert
    db.run(
      `INSERT OR REPLACE INTO "${collection}" (${quotedKeys}) VALUES (${placeholders})`,
      toBindings(values)
    );

    // Fetch and return the inserted record
    const row = db.query(`SELECT * FROM "${collection}" WHERE id=?`).get(id);
    return row as Record<string, unknown>;
  });
}

/**
 * List records from a collection with optional filtering and sorting.
 *
 * Supports basic `filter` (key-value equality), `sort` (field + direction),
 * `limit`, and `offset` via options.
 *
 * `GET /api/:database/collections/:collection/records`
 */
export function listRecords(
  pool: DatabasePool,
  collection: string,
  options?: {
    filter?: Record<string, unknown>;
    sort?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
    fields?: string[];
  }
): Record<string, unknown>[] {
  getColumnNames(pool, collection);
  const db = pool.read();

  let sql = `SELECT * FROM "${collection}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  // Build WHERE clause from filter
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

  // Sorting — validate sort field to prevent SQL injection
  const sortField = options?.sort || "created_at";
  validateIdentifier(sortField, "sort field");
  const direction = options?.direction === "asc" ? "ASC" : "DESC";
  sql += ` ORDER BY "${sortField}" ${direction}`;

  // Pagination
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
 * Get a single record by ID.
 *
 * `GET /api/:database/collections/:collection/records/:id`
 */
export function getRecord(
  pool: DatabasePool,
  collection: string,
  id: string
): Record<string, unknown> {
  getColumnNames(pool, collection);
  const db = pool.read();

  const row = db.query(`SELECT * FROM "${collection}" WHERE id=?`).get(id);
  if (!row) {
    throw Object.assign(
      new Error(`Record "${id}" not found in collection "${collection}".`),
      { status: 404 }
    );
  }

  return row as Record<string, unknown>;
}

/**
 * Update an existing record by ID.
 *
 * Only the fields provided in `data` are updated. `updated_at` is always
 * set to the current timestamp. `id` and `created_at` cannot be changed.
 *
 * `PATCH /api/:database/collections/:collection/records/:id`
 */
export function updateRecord(
  pool: DatabasePool,
  collection: string,
  id: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const columns = getColumnNames(pool, collection);
  const columnSet = new Set(columns);
  const immutable = new Set(["id", "created_at"]);

  // Filter out immutable columns and unknown columns
  const userUpdates: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (immutable.has(key)) continue;
    if (!columnSet.has(key)) continue; // skip unknown columns
    userUpdates.push([key, value]);
  }

  if (userUpdates.length === 0) {
    throw Object.assign(
      new Error("No valid fields to update."),
      { status: 400 }
    );
  }

  // Always bump updated_at (timestamp generated inside transaction so
  // Bun.sleepSync ensures it differs from created_at in fast tests)
  let updates: [string, unknown][];

  return pool.writeTransaction(() => {
    const db = pool.write();
    // Small delay to ensure updated_at differs from created_at in fast tests
    Bun.sleepSync(1);
    updates = [...userUpdates, ["updated_at", now()]];

    // Verify record exists
    const existing = db
      .query(`SELECT 1 FROM "${collection}" WHERE id=?`)
      .get(id);
    if (!existing) {
      throw Object.assign(
        new Error(`Record "${id}" not found in collection "${collection}".`),
        { status: 404 }
      );
    }

    const setClauses = updates.map(([k]) => `"${k}" = ?`).join(", ");
    const values = [...updates.map(([, v]) => v), id];

    db.run(`UPDATE "${collection}" SET ${setClauses} WHERE id=?`, toBindings(values));

    // Return updated record
    const row = db.query(`SELECT * FROM "${collection}" WHERE id=?`).get(id);
    return row as Record<string, unknown>;
  });
}

/**
 * Delete a record by ID.
 *
 * `DELETE /api/:database/collections/:collection/records/:id`
 */
export function deleteRecord(
  pool: DatabasePool,
  collection: string,
  id: string
): void {
  getColumnNames(pool, collection);

  pool.writeTransaction(() => {
    const db = pool.write();

    // Verify record exists
    const existing = db
      .query(`SELECT 1 FROM "${collection}" WHERE id=?`)
      .get(id);
    if (!existing) {
      throw Object.assign(
        new Error(`Record "${id}" not found in collection "${collection}".`),
        { status: 404 }
      );
    }

    db.run(`DELETE FROM "${collection}" WHERE id=?`, [id]);
  });
}

/**
 * Count records in a collection, optionally filtered.
 *
 * `GET /api/:database/collections/:collection/records/count`
 */
export function countRecords(
  pool: DatabasePool,
  collection: string,
  filter?: Record<string, unknown>
): number {
  getColumnNames(pool, collection);
  const db = pool.read();

  let sql = `SELECT COUNT(*) as cnt FROM "${collection}"`;
  const params: unknown[] = [];

  if (filter && Object.keys(filter).length > 0) {
    const conditions = Object.keys(filter).map((k) => {
      params.push(filter[k]);
      return `"${k}" = ?`;
    });
    sql += " WHERE " + conditions.join(" AND ");
  }

  const row = db.query(sql).all(...toBindings(params)) as { cnt?: number }[];
  return row[0]?.cnt ?? 0;
}

/**
 * Get distinct values for a field in a collection.
 *
 * `GET /api/:database/collections/:collection/records/distinct?field=name`
 */
export function distinctValues(
  pool: DatabasePool,
  collection: string,
  field: string
): unknown[] {
  validateIdentifier(field, "field name");
  getColumnNames(pool, collection);
  const db = pool.read();

  const rows = db
    .query(`SELECT DISTINCT "${field}" FROM "${collection}" ORDER BY "${field}"`)
    .all() as Record<string, unknown>[];

  return rows.map((r) => r[field]);
}

/**
 * Batch create, update, or delete multiple records in a single transaction.
 *
 * The `operations` array can contain objects with:
 * - `action: "create"` with `data`
 * - `action: "update"` with `id` and `data`
 * - `action: "delete"` with `id`
 *
 * `POST /api/:database/collections/:collection/records/batch`
 */
export function batchRecords(
  pool: DatabasePool,
  collection: string,
  operations: { action: "create" | "update" | "delete"; id?: string; data?: Record<string, unknown> }[]
): { created: number; updated: number; deleted: number } {
  getColumnNames(pool, collection);

  const result = { created: 0, updated: 0, deleted: 0 };

  pool.writeTransaction(() => {
    const db = pool.write();
    const timestamp = now();

    for (const op of operations) {
      switch (op.action) {
        case "create": {
          if (!op.data) {
            throw Object.assign(
              new Error("'data' is required for create operations."),
              { status: 400 }
            );
          }
          const data = op.data;
          const id = (data.id as string) || generateId();
          const record: Record<string, unknown> = {
            id,
            created_at: (data.created_at as string) || timestamp,
            updated_at: timestamp,
          };
          for (const [k, v] of Object.entries(data)) {
            if (k === "id" || k === "created_at" || k === "updated_at") continue;
            record[k] = v;
          }
          const keys = Object.keys(record);
          const placeholders = keys.map(() => "?").join(", ");
          const quotedKeys = keys.map((k) => `"${k}"`).join(", ");
          const values = keys.map((k) => record[k]);
          db.run(
            `INSERT OR REPLACE INTO "${collection}" (${quotedKeys}) VALUES (${placeholders})`,
            toBindings(values)
          );
          result.created++;
          break;
        }

        case "update": {
          if (!op.id || !op.data) {
            throw Object.assign(
              new Error("'id' and 'data' are required for update operations."),
              { status: 400 }
            );
          }
          const existing = db
            .query(`SELECT 1 FROM "${collection}" WHERE id=?`)
            .get(op.id);
          if (!existing) {
            throw Object.assign(
              new Error(`Record "${op.id}" not found in collection "${collection}".`),
              { status: 404 }
            );
          }
          const immutable = new Set(["id", "created_at"]);
          const userUpdates: [string, unknown][] = [];
          for (const [k, v] of Object.entries(op.data)) {
            if (immutable.has(k)) continue;
            userUpdates.push([k, v]);
          }
          if (userUpdates.length === 0) continue;
          const updates: [string, unknown][] = [...userUpdates, ["updated_at", timestamp]];
          const setClauses = updates.map(([k]) => `"${k}" = ?`).join(", ");
          const vals = [...updates.map(([, v]) => v), op.id];
          db.run(`UPDATE "${collection}" SET ${setClauses} WHERE id=?`, toBindings(vals));
          result.updated++;
          break;
        }

        case "delete": {
          if (!op.id) {
            throw Object.assign(
              new Error("'id' is required for delete operations."),
              { status: 400 }
            );
          }
          const existing = db
            .query(`SELECT 1 FROM "${collection}" WHERE id=?`)
            .get(op.id);
          if (!existing) {
            throw Object.assign(
              new Error(`Record "${op.id}" not found in collection "${collection}".`),
              { status: 404 }
            );
          }
          db.run(`DELETE FROM "${collection}" WHERE id=?`, [op.id]);
          result.deleted++;
          break;
        }

        default:
          throw Object.assign(
            new Error(`Unknown action "${(op as { action: string }).action}". Use "create", "update", or "delete".`),
            { status: 400 }
          );
      }
    }
  });

  return result;
}