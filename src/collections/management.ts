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
  ColumnDefinition,
  CollectionInfo,
  SQLITE_TYPE_MAP,
  validateIdentifier,
  isReservedTable,
  type ColumnType,
} from "@boltstore/utils";
import { setRLS, type RLSConfig } from "../rls";
import { setRelations, type RelationDefinition } from "../relations";
import { invalidateSchemaCache } from "../records";
import { buildCreateTableSQL, rowToColumnDef, tableExists } from "./ddl";

// ---------------------------------------------------------------------------
// Public API — collection management
// ---------------------------------------------------------------------------

/**
 * Create a new collection (table).
 *
 * This is an **admin-only** operation (`POST /api/admin/collections`).
 * The table is created with system columns `id`, `created_at`, and `updated_at`
 * plus the user-specified columns.
 *
 * @param options.rls - Optional Row-Level Security rules for the collection.
 */
export function createCollection(
  pool: DatabasePool,
  name: string,
  columns: ColumnDefinition[],
  options?: { rls?: RLSConfig; relations?: Record<string, RelationDefinition> }
): CollectionInfo {
  // Validate collection name
  validateIdentifier(name, "collection name");
  if (isReservedTable(name)) {
    throw Object.assign(
      new Error(`Cannot create reserved table "${name}".`),
      { status: 403 }
    );
  }

  if (!Array.isArray(columns) || columns.length === 0) {
    throw Object.assign(
      new Error("At least one column is required to create a collection."),
      { status: 400 }
    );
  }

  // Validate column types
  for (const col of columns) {
    if (!col.name || typeof col.name !== "string") {
      throw Object.assign(
        new Error("Each column must have a 'name' (string)."),
        { status: 400 }
      );
    }
    validateIdentifier(col.name, "column name");
    // Prevent system column name collisions
    if (col.name === "id" || col.name === "created_at" || col.name === "updated_at") {
      throw Object.assign(
        new Error(`Cannot use reserved column name "${col.name}".`),
        { status: 400 }
      );
    }
    if (!SQLITE_TYPE_MAP[col.type]) {
      throw Object.assign(
        new Error(
          `Invalid column type "${col.type}" for column "${col.name}". Supported types: ${Object.keys(SQLITE_TYPE_MAP).join(", ")}.`
        ),
        { status: 400 }
      );
    }
  }

  return pool.writeTransaction(() => {
    const db = pool.write();

    // Check for duplicate
    if (tableExists(pool, name)) {
      throw Object.assign(
        new Error(`Collection "${name}" already exists.`),
        { status: 409 }
      );
    }

    // Ensure _collections metadata table exists
    db.run(`
      CREATE TABLE IF NOT EXISTS _collections (
        name TEXT PRIMARY KEY,
        schema_json TEXT NOT NULL,
        read_rule TEXT,
        write_rule TEXT,
        relations_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Migrate existing _collections that lack RLS/relations columns
    try { db.run("ALTER TABLE _collections ADD COLUMN read_rule TEXT"); } catch {}
    try { db.run("ALTER TABLE _collections ADD COLUMN write_rule TEXT"); } catch {}
    try { db.run("ALTER TABLE _collections ADD COLUMN relations_json TEXT"); } catch {}

    // Create the actual table
    const sql = buildCreateTableSQL(name, columns);
    db.run(sql);
    invalidateSchemaCache(pool, name);

    // Store metadata
    const now = new Date().toISOString();
    const schemaJson = JSON.stringify(columns);
    db.run(
      "INSERT INTO _collections (name, schema_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [name, schemaJson, now, now]
    );

    // Apply RLS if provided
    if (options?.rls) {
      setRLS(pool, name, options.rls);
    }

    // Apply relation metadata if provided
    if (options?.relations) {
      setRelations(pool, name, options.relations);
    }

    return {
      name,
      columns: columns,
      relations: options?.relations ? Object.fromEntries(
        Object.entries(options.relations).map(([k, v]) => [
          k,
          { field: v.field, foreignCollection: v.foreignCollection, cascadeDelete: v.cascadeDelete },
        ])
      ) : undefined,
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * List all user-created collections.
 *
 * `GET /api/collections`
 */
export function listCollections(pool: DatabasePool): CollectionInfo[] {
  const db = pool.read();

  // Ensure _collections exists
  const metaExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_collections'")
    .get();
  if (!metaExists) {
    return [];
  }

  const rows = db.query("SELECT name, schema_json, relations_json, created_at, updated_at FROM _collections ORDER BY name").all();

  return (rows as Record<string, unknown>[]).map((row: Record<string, unknown>) => {
    const name = String(row.name || "");
    let schema: ColumnDefinition[] = [];
    try {
      schema = JSON.parse(String(row.schema_json || "[]"));
    } catch {
      schema = [];
    }

    let relations: Record<string, { field: string; foreignCollection: string; cascadeDelete?: boolean }> | undefined;
    if (row.relations_json) {
      try {
        relations = JSON.parse(String(row.relations_json));
      } catch {
      }
    }

    // Get live record count
    let recordCount = 0;
    try {
      const countRow = db.query(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt?: number } | null;
      recordCount = countRow?.cnt ?? 0;
    } catch {
      recordCount = 0;
    }

    return {
      name,
      columns: schema,
      relations,
      recordCount,
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
    };
  });
}

/**
 * Get details for a single collection, including its full schema from PRAGMA table_info.
 *
 * `GET /api/collections/:collection`
 */
export function getCollection(pool: DatabasePool, name: string): CollectionInfo {
  validateIdentifier(name, "collection name");
  const db = pool.read();

  if (!tableExists(pool, name)) {
    throw Object.assign(
      new Error(`Collection "${name}" not found.`),
      { status: 404 }
    );
  }

  // Get schema from PRAGMA
  const pragmaRows = db.query(`PRAGMA table_info("${name}")`).all() as Record<string, unknown>[];
  const allColumns: ColumnDefinition[] = pragmaRows.map(rowToColumnDef);

  // Separate system columns
  const systemCols = new Set(["id", "created_at", "updated_at"]);
  const userColumns = allColumns.filter((c) => !systemCols.has(c.name));

  // Restore original column types (e.g. BOOLEAN) from _collections.schema_json
  const metaRow = db.query("SELECT schema_json, relations_json, created_at, updated_at FROM _collections WHERE name=?").get(name) as
    | { schema_json?: string; relations_json?: string; created_at?: string; updated_at?: string }
    | null;
  if (metaRow?.schema_json) {
    try {
      const originalSchema = JSON.parse(metaRow.schema_json) as ColumnDefinition[];
      const typeMap = new Map(originalSchema.map((c) => [c.name, c.type]));
      for (const col of userColumns) {
        const originalType = typeMap.get(col.name);
        if (originalType) col.type = originalType;
      }
    } catch {
    }
  }

  // Record count
  const countRow = db.query(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt?: number } | null;
  const recordCount = countRow?.cnt ?? 0;

  let relations: Record<string, { field: string; foreignCollection: string; cascadeDelete?: boolean }> | undefined;
  if (metaRow?.relations_json) {
    try {
      relations = JSON.parse(metaRow.relations_json);
    } catch {
    }
  }

  return {
    name,
    columns: userColumns,
    relations,
    recordCount,
    createdAt: metaRow?.created_at || "",
    updatedAt: metaRow?.updated_at || "",
  };
}

/**
 * Update a collection schema by adding new columns.
 *
 * This is an **admin-only** operation (`PATCH /api/admin/collections/:collection`).
 *
 * SQLite only supports `ALTER TABLE ADD COLUMN` — existing columns cannot be
 * modified or removed. To restructure a table, use the migration system (Phase 1.15).
 */
export function updateCollection(
  pool: DatabasePool,
  name: string,
  newColumns: ColumnDefinition[],
  options?: { rls?: RLSConfig; relations?: Record<string, RelationDefinition> }
): CollectionInfo {
  validateIdentifier(name, "collection name");

  if (isReservedTable(name)) {
    throw Object.assign(
      new Error(`Cannot modify reserved table "${name}".`),
      { status: 403 }
    );
  }

  if (!Array.isArray(newColumns) || newColumns.length === 0) {
    throw Object.assign(
      new Error("At least one column is required to update a collection schema."),
      { status: 400 }
    );
  }

  return pool.writeTransaction(() => {
    const db = pool.write();

    if (!tableExists(pool, name)) {
      throw Object.assign(
        new Error(`Collection "${name}" not found.`),
        { status: 404 }
      );
    }

    // Get existing columns from PRAGMA to avoid duplicates
    const existingRows = db.query(`PRAGMA table_info("${name}")`).all() as Record<string, unknown>[];
    const existingNames = new Set(existingRows.map((r) => String(r.name || "").toLowerCase()));

    for (const col of newColumns) {
      if (!col.name || typeof col.name !== "string") {
        throw Object.assign(
          new Error("Each column must have a 'name' (string)."),
          { status: 400 }
        );
      }
      validateIdentifier(col.name, "column name");

      if (existingNames.has(col.name.toLowerCase())) {
        throw Object.assign(
          new Error(`Column "${col.name}" already exists on collection "${name}".`),
          { status: 409 }
        );
      }

      if (!SQLITE_TYPE_MAP[col.type]) {
        throw Object.assign(
          new Error(
            `Invalid column type "${col.type}" for column "${col.name}". Supported types: ${Object.keys(SQLITE_TYPE_MAP).join(", ")}.`
          ),
          { status: 400 }
        );
      }

      const sqlType = SQLITE_TYPE_MAP[col.type];
      let def = `"${col.name}" ${sqlType}`;
      if (col.required) def += " NOT NULL";
      if (col.default !== undefined) {
        const dv = col.default;
        if (dv === null) def += " DEFAULT NULL";
        else if (typeof dv === "string") def += ` DEFAULT '${dv.replace(/'/g, "''")}'`;
        else if (typeof dv === "boolean") def += ` DEFAULT ${dv ? 1 : 0}`;
        else def += ` DEFAULT ${dv}`;
      }
      if (col.unique) def += " UNIQUE";

      db.run(`ALTER TABLE "${name}" ADD COLUMN ${def}`);
    }

    // Update _collections metadata
    const now = new Date().toISOString();

    // Merge old + new schema
    const oldMeta = db.query("SELECT schema_json FROM _collections WHERE name=?").get(name) as
      | { schema_json?: string }
      | null;
    let oldSchema: ColumnDefinition[] = [];
    if (oldMeta?.schema_json) {
      try { oldSchema = JSON.parse(oldMeta.schema_json); } catch { /* ignore */ }
    }
    const mergedSchema = [...oldSchema, ...newColumns];
    const schemaJson = JSON.stringify(mergedSchema);

    db.run("UPDATE _collections SET schema_json=?, updated_at=? WHERE name=?", [schemaJson, now, name]);

    // Apply RLS if provided
    if (options?.rls) {
      setRLS(pool, name, options.rls);
    }

    // Apply relation metadata if provided
    if (options?.relations) {
      setRelations(pool, name, options.relations);
    }

    invalidateSchemaCache(pool, name);

    // Return info
    const countRow = db.query(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt?: number } | null;

    return {
      name,
      columns: mergedSchema,
      recordCount: countRow?.cnt ?? 0,
      createdAt: "", // unchanged, not returned here
      updatedAt: now,
    };
  });
}

/**
 * Delete a collection (drop the table).
 *
 * This is an **admin-only** operation (`DELETE /api/admin/collections/:collection`).
 */
export function deleteCollection(pool: DatabasePool, name: string): void {
  validateIdentifier(name, "collection name");

  if (isReservedTable(name)) {
    throw Object.assign(
      new Error(`Cannot delete reserved table "${name}".`),
      { status: 403 }
    );
  }

  if (name.startsWith("_")) {
    throw Object.assign(
      new Error(`Cannot delete system table "${name}".`),
      { status: 403 }
    );
  }

  pool.writeTransaction(() => {
    const db = pool.write();

    if (!tableExists(pool, name)) {
      throw Object.assign(
        new Error(`Collection "${name}" not found.`),
        { status: 404 }
      );
    }

    db.run(`DROP TABLE "${name}"`);
    db.run("DELETE FROM _collections WHERE name=?", [name]);
    invalidateSchemaCache(pool, name);
  });
}
