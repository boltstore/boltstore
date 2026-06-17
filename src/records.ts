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
import { validateIdentifier, generateSecureId } from "@boltstore/utils";
import { applyRLS, toRLSContext, type RLSContext } from "./rls";
import type { AuthContext } from "./middleware/auth";

/** Generate a unique record ID. */
function generateId(): string {
  return generateSecureId("rec");
}

/** Get current ISO-8601 timestamp. */
function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Pagination constants
// ---------------------------------------------------------------------------

const MAX_LIMIT = 1000;
const MAX_OFFSET = 100000;

// ---------------------------------------------------------------------------
// Per-pool schema cache
// ---------------------------------------------------------------------------

interface SchemaCacheEntry {
  columns: string[];
  exists: boolean;
  fetchedAt: number;
}

const schemaCache = new WeakMap<DatabasePool, Map<string, SchemaCacheEntry>>();
const SCHEMA_CACHE_TTL_MS = 30_000;

function getPoolCache(pool: DatabasePool): Map<string, SchemaCacheEntry> {
  let cache = schemaCache.get(pool);
  if (!cache) {
    cache = new Map();
    schemaCache.set(pool, cache);
  }
  return cache;
}

export function invalidateSchemaCache(pool: DatabasePool, collection?: string): void {
  const cache = schemaCache.get(pool);
  if (!cache) return;
  if (collection) {
    cache.delete(collection);
  } else {
    cache.clear();
  }
}

function fetchColumns(pool: DatabasePool, collection: string): SchemaCacheEntry {
  validateIdentifier(collection, "collection name");
  const db = pool.read();
  const existsRow = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(collection);
  if (!existsRow) {
    return { columns: [], exists: false, fetchedAt: Date.now() };
  }
  const rows = db.query(`PRAGMA table_info("${collection}")`).all() as { name: string }[];
  return { columns: rows.map((r) => r.name), exists: true, fetchedAt: Date.now() };
}

function getColumnNames(pool: DatabasePool, collection: string): string[] {
  const cache = getPoolCache(pool);
  const entry = cache.get(collection);
  if (entry && Date.now() - entry.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    if (!entry.exists) {
      throw Object.assign(
        new Error(`Collection "${collection}" not found.`),
        { status: 404 }
      );
    }
    return entry.columns;
  }
  const fresh = fetchColumns(pool, collection);
  cache.set(collection, fresh);
  if (!fresh.exists) {
    throw Object.assign(
      new Error(`Collection "${collection}" not found.`),
      { status: 404 }
    );
  }
  return fresh.columns;
}

export function collectionExists(pool: DatabasePool, collection: string): boolean {
  const cache = getPoolCache(pool);
  const entry = cache.get(collection);
  if (entry && Date.now() - entry.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return entry.exists;
  }
  const fresh = fetchColumns(pool, collection);
  cache.set(collection, fresh);
  return fresh.exists;
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
  data: Record<string, unknown>,
  auth?: AuthContext
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

export interface ListRecordsResult {
  records: Record<string, unknown>[];
  meta: {
    total?: number;
    page?: number;
    per_page?: number;
    total_pages?: number;
    next_cursor?: string | null;
  };
}

export interface PaginationMetaOptions {
  page: number;
  perPage: number;
  filter?: Record<string, unknown>;
  sort?: string;
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
    page?: number;
    perPage?: number;
    cursor?: string;
    fields?: string[];
  },
  auth?: AuthContext
): Record<string, unknown>[] {
  getColumnNames(pool, collection);
  const db = pool.read();

  // Normalize page/perPage to limit/offset
  let limit = options?.limit;
  let offset = options?.offset;
  let page: number | undefined;
  let perPage: number | undefined;
  if (options?.page !== undefined && options?.perPage !== undefined) {
    page = options.page;
    perPage = options.perPage;
    limit = perPage;
    offset = (page - 1) * perPage;
  }

  if (limit !== undefined) {
    limit = Math.max(1, Math.min(limit, MAX_LIMIT));
  }
  if (offset !== undefined) {
    offset = Math.max(0, Math.min(offset, MAX_OFFSET));
  }

  const selectCols = options?.fields?.length
    ? options.fields.map((f) => `"${f}"`).join(", ")
    : "*";

  let sql = `SELECT ${selectCols} FROM "${collection}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  // RLS read policy
  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;
  if (rls?.whereClause) {
    conditions.push(rls.whereClause);
    params.push(...rls.params);
  }

  // Build WHERE clause from filter
  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        throw Object.assign(new Error(`Filter value for "${key}" must be a scalar or array.`), { status: 400 });
      }
      validateIdentifier(key, "filter field");
      conditions.push(`"${key}" = ?`);
      params.push(value);
    }
  }

  // Cursor-based pagination (keyset on sort field)
  const sortField = options?.sort || "created_at";
  validateIdentifier(sortField, "sort field");
  if (options?.cursor) {
    const op = options.direction === "asc" ? ">" : "<";
    conditions.push(`"${sortField}" ${op} ?`);
    params.push(options.cursor);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  // Sorting — validate sort field to prevent SQL injection
  const direction = options?.direction === "asc" ? "ASC" : "DESC";
  sql += ` ORDER BY "${sortField}" ${direction}`;

  // Pagination
  if (limit !== undefined) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  if (offset !== undefined) {
    sql += ` OFFSET ?`;
    params.push(offset);
  }

  const records = db.query(sql).all(...toBindings(params)) as Record<string, unknown>[];
  return records;
}

/**
 * Build a safe SELECT query for listing records.
 */
export function buildListSql(
  collection: string,
  options?: {
    filter?: Record<string, unknown>;
    sort?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
    cursor?: string;
    fields?: string[];
  }
): { sql: string; params: unknown[] } {
  validateIdentifier(collection, "collection name");
  const selectCols = options?.fields?.length
    ? options.fields.map((f) => `"${f}"`).join(", ")
    : "*";
  let sql = `SELECT ${selectCols} FROM "${collection}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        throw Object.assign(new Error(`Filter value for "${key}" must be a scalar or array.`), { status: 400 });
      }
      validateIdentifier(key, "filter field");
      conditions.push(`"${key}" = ?`);
      params.push(value);
    }
  }

  const sortField = options?.sort || "created_at";
  validateIdentifier(sortField, "sort field");
  if (options?.cursor) {
    const op = options.direction === "asc" ? ">" : "<";
    conditions.push(`"${sortField}" ${op} ?`);
    params.push(options.cursor);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  const direction = options?.direction === "asc" ? "ASC" : "DESC";
  sql += ` ORDER BY "${sortField}" ${direction}`;

  let limit = options?.limit;
  let offset = options?.offset;
  if (limit !== undefined) {
    limit = Math.max(1, Math.min(limit, MAX_LIMIT));
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  if (offset !== undefined) {
    offset = Math.max(0, Math.min(offset, MAX_OFFSET));
    sql += ` OFFSET ?`;
    params.push(offset);
  }

  return { sql, params };
}

/**
 * Build pagination metadata for a list query.
 * Used by HTTP routes to wrap `listRecords` results.
 */
export function buildPaginationMeta(
  pool: DatabasePool,
  collection: string,
  options: PaginationMetaOptions,
  auth?: AuthContext,
  lastRecord?: Record<string, unknown>
): ListRecordsResult["meta"] {
  const total = countRecords(pool, collection, options.filter, auth);
  const meta: ListRecordsResult["meta"] = {
    total,
    page: options.page,
    per_page: options.perPage,
    total_pages: Math.ceil(total / options.perPage),
  };
  if (lastRecord) {
    const key = options.sort || "created_at";
    meta.next_cursor = lastRecord[key] as string | null;
  }
  return meta;
}

/**
 * Get a single record by ID.
 *
 * `GET /api/:database/collections/:collection/records/:id`
 */
export function getRecord(
  pool: DatabasePool,
  collection: string,
  id: string,
  auth?: AuthContext
): Record<string, unknown> {
  getColumnNames(pool, collection);
  const db = pool.read();

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;

  let sql = `SELECT * FROM "${collection}" WHERE id=?`;
  const params: unknown[] = [id];
  if (rls?.whereClause) {
    sql += ` AND ${rls.whereClause}`;
    params.push(...rls.params);
  }

  const row = db.query(sql).get(...toBindings(params));
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
  data: Record<string, unknown>,
  auth?: AuthContext
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

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "write", rlsCtx) : null;

  return pool.writeTransaction(() => {
    const db = pool.write();
    const nowValue = (db.query("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as now").get() as { now: string }).now;
    const updates: [string, unknown][] = [...userUpdates, ["updated_at", nowValue]];

    // Verify record exists and is accessible
    let selectSql = `SELECT 1 FROM "${collection}" WHERE id=?`;
    const selectParams: unknown[] = [id];
    if (rls?.whereClause) {
      selectSql += ` AND ${rls.whereClause}`;
      selectParams.push(...rls.params);
    }
    const existing = db.query(selectSql).get(...toBindings(selectParams));
    if (!existing) {
      throw Object.assign(
        new Error(`Record "${id}" not found in collection "${collection}".`),
        { status: 404 }
      );
    }

    const setClauses = updates.map(([k]) => `"${k}" = ?`).join(", ");
    const values = [...updates.map(([, v]) => v), id];

    let updateSql = `UPDATE "${collection}" SET ${setClauses} WHERE id=?`;
    if (rls?.whereClause) {
      updateSql += ` AND ${rls.whereClause}`;
      values.push(...rls.params);
    }

    db.run(updateSql, toBindings(values));

    // Return updated record read with a new query so it reflects committed timestamp.
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
  id: string,
  auth?: AuthContext
): void {
  getColumnNames(pool, collection);

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "write", rlsCtx) : null;

  pool.writeTransaction(() => {
    const db = pool.write();

    // Verify record exists and is accessible
    let selectSql = `SELECT 1 FROM "${collection}" WHERE id=?`;
    const selectParams: unknown[] = [id];
    if (rls?.whereClause) {
      selectSql += ` AND ${rls.whereClause}`;
      selectParams.push(...rls.params);
    }
    const existing = db.query(selectSql).get(...toBindings(selectParams));
    if (!existing) {
      throw Object.assign(
        new Error(`Record "${id}" not found in collection "${collection}".`),
        { status: 404 }
      );
    }

    let deleteSql = `DELETE FROM "${collection}" WHERE id=?`;
    const params: unknown[] = [id];
    if (rls?.whereClause) {
      deleteSql += ` AND ${rls.whereClause}`;
      params.push(...rls.params);
    }

    db.run(deleteSql, toBindings(params));
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
  filter?: Record<string, unknown>,
  auth?: AuthContext
): number {
  getColumnNames(pool, collection);
  const db = pool.read();

  let sql = `SELECT COUNT(*) as cnt FROM "${collection}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;
  if (rls?.whereClause) {
    conditions.push(rls.whereClause);
    params.push(...rls.params);
  }

  if (filter && Object.keys(filter).length > 0) {
    for (const [k, v] of Object.entries(filter)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        throw Object.assign(new Error(`Filter value for "${k}" must be a scalar or array.`), { status: 400 });
      }
      conditions.push(`"${k}" = ?`);
      params.push(v);
    }
  }

  if (conditions.length > 0) {
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
  field: string,
  auth?: AuthContext
): unknown[] {
  validateIdentifier(field, "field name");
  getColumnNames(pool, collection);
  const db = pool.read();

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;

  let sql = `SELECT DISTINCT "${field}" FROM "${collection}"`;
  const params: unknown[] = [];
  if (rls?.whereClause) {
    sql += ` WHERE ${rls.whereClause}`;
    params.push(...rls.params);
  }
  sql += ` ORDER BY "${field}"`;

  const rows = db.query(sql).all(...toBindings(params)) as Record<string, unknown>[];

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
  operations: { action: "create" | "update" | "delete"; id?: string; data?: Record<string, unknown> }[],
  auth?: AuthContext
): { created: number; updated: number; deleted: number } {
  getColumnNames(pool, collection);

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "write", rlsCtx) : null;

  if (operations.length > 1000) {
    throw Object.assign(
      new Error("Batch operations limited to 1000 per request."),
      { status: 400 }
    );
  }

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
          let selectSql = `SELECT 1 FROM "${collection}" WHERE id=?`;
          const selectParams: unknown[] = [op.id];
          if (rls?.whereClause) {
            selectSql += ` AND ${rls.whereClause}`;
            selectParams.push(...rls.params);
          }
          const existing = db.query(selectSql).get(...toBindings(selectParams));
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
          let updateSql = `UPDATE "${collection}" SET ${setClauses} WHERE id=?`;
          if (rls?.whereClause) {
            updateSql += ` AND ${rls.whereClause}`;
            vals.push(...rls.params);
          }
          db.run(updateSql, toBindings(vals));
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
          let selectSql = `SELECT 1 FROM "${collection}" WHERE id=?`;
          const selectParams: unknown[] = [op.id];
          if (rls?.whereClause) {
            selectSql += ` AND ${rls.whereClause}`;
            selectParams.push(...rls.params);
          }
          const existing = db.query(selectSql).get(...toBindings(selectParams));
          if (!existing) {
            throw Object.assign(
              new Error(`Record "${op.id}" not found in collection "${collection}".`),
              { status: 404 }
            );
          }
          let deleteSql = `DELETE FROM "${collection}" WHERE id=?`;
          const params: unknown[] = [op.id];
          if (rls?.whereClause) {
            deleteSql += ` AND ${rls.whereClause}`;
            params.push(...rls.params);
          }
          db.run(deleteSql, toBindings(params));
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
