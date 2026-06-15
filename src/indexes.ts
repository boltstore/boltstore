/**
 * Index management for Boltstore collections.
 *
 * Handles creating, listing, and dropping indexes on collection tables.
 * Supports single-field, composite (multi-field), and unique indexes.
 *
 * @module boltstore/indexes
 */

import { DatabasePool } from "./db/pool";
import { validateIdentifier } from "@boltstore/utils";

/** Information about an indexed column. */
export interface IndexColumn {
  /** Column position within the index (0-based). */
  position: number;
  /** Column name. */
  name: string;
}

/** Runtime information about an existing index. */
export interface IndexInfo {
  /** Index name. */
  name: string;
  /** Whether the index is unique. */
  unique: boolean;
  /** Whether the index was created by Boltstore (not an implicit or system index). */
  userDefined: boolean;
  /** Columns in the index, ordered by position. */
  columns: IndexColumn[];
  /** The CREATE INDEX SQL statement. */
  sql: string;
}

/** Definition for creating a new index. */
export interface IndexDefinition {
  /** Columns to index. Supports ascending/descending via "column:asc" or "column:desc" notation. */
  columns: string[];
  /** Whether the index should enforce uniqueness. Default: false. */
  unique?: boolean;
}

/**
 * Internal system indexes (auto-created by SQLite) that should be excluded from listings.
 * SQLite creates indexes for PRIMARY KEY and UNIQUE constraints automatically.
 */
const SYSTEM_INDEX_PREFIXES = ["sqlite_autoindex_"];

/**
 * Create an index on a collection.
 *
 * `POST /api/admin/:database/collections/:collection/indexes`
 */
export function createIndex(
  pool: DatabasePool,
  collection: string,
  name: string,
  definition: IndexDefinition
): IndexInfo {
  validateIdentifier(collection, "collection name");
  validateIdentifier(name, "index name");

  if (!Array.isArray(definition.columns) || definition.columns.length === 0) {
    throw Object.assign(
      new Error("At least one column is required to create an index."),
      { status: 400 }
    );
  }

  // Validate each column name pattern
  const parsedColumns: { name: string; direction: "ASC" | "DESC" }[] = [];
  for (const colSpec of definition.columns) {
    const [colName, dir] = colSpec.split(":");
    validateIdentifier(colName, "column name");
    parsedColumns.push({
      name: colName,
      direction: dir === "desc" ? "DESC" : "ASC",
    });
  }

  return pool.writeTransaction(() => {
    const db = pool.write();

    // Verify collection exists
    const tableExists = db
      .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(collection);
    if (!tableExists) {
      throw Object.assign(
        new Error(`Collection "${collection}" not found.`),
        { status: 404 }
      );
    }

    // Check for duplicate index name
    const existing = db
      .query("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
      .get(name);
    if (existing) {
      throw Object.assign(
        new Error(`Index "${name}" already exists.`),
        { status: 409 }
      );
    }

    const uniqueKeyword = definition.unique ? "UNIQUE " : "";
    const colSpecs = parsedColumns
      .map((c) => `"${c.name}" ${c.direction}`)
      .join(", ");

    const sql = `CREATE ${uniqueKeyword}INDEX "${name}" ON "${collection}" (${colSpecs})`;
    db.run(sql);

    // Use db directly (write connection) since read pool won't see the index yet
    // within the same transaction before WAL checkpoint
    const indexRow = db
      .query("SELECT name, sql FROM sqlite_master WHERE type='index' AND name=?")
      .get(name) as { name: string; sql: string } | null;

    if (!indexRow) {
      throw new Error(`Index "${name}" was not created successfully.`);
    }

    const pragmaRows = db
      .query(`PRAGMA index_info("${name}")`)
      .all() as { seqno: number; cid: number; name: string }[];

    const columns: IndexColumn[] = pragmaRows.map((p) => ({
      position: p.seqno,
      name: p.name,
    }));

    return {
      name: indexRow.name,
      unique: !!definition.unique,
      userDefined: true,
      columns,
      sql: indexRow.sql,
    };
  });
}

/**
 * List all indexes on a collection.
 *
 * Excludes internal SQLite autoindexes (primary key, unique constraint indexes).
 *
 * `GET /api/admin/:database/collections/:collection/indexes`
 */
export function listIndexes(pool: DatabasePool, collection: string): IndexInfo[] {
  validateIdentifier(collection, "collection name");
  const db = pool.read();

  // Verify collection exists
  const tableExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(collection);
  if (!tableExists) {
    throw Object.assign(
      new Error(`Collection "${collection}" not found.`),
      { status: 404 }
    );
  }

  const rows = db
    .query("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name")
    .all(collection) as { name: string; sql: string }[];

  return rows
    .filter((r) => !SYSTEM_INDEX_PREFIXES.some((prefix) => r.name.startsWith(prefix)))
    .map((r) => {
      const pragmaRows = db
        .query(`PRAGMA index_info("${r.name}")`)
        .all() as { seqno: number; cid: number; name: string }[];

      const columns: IndexColumn[] = pragmaRows.map((p) => ({
        position: p.seqno,
        name: p.name,
      }));

      const unique = r.sql.toUpperCase().includes("CREATE UNIQUE INDEX");

      return {
        name: r.name,
        unique,
        userDefined: true,
        columns,
        sql: r.sql,
      };
    });
}

/**
 * Get details for a single index.
 */
export function getIndex(
  pool: DatabasePool,
  collection: string,
  name: string
): IndexInfo {
  validateIdentifier(collection, "collection name");
  const db = pool.read();

  const row = db
    .query("SELECT name, sql FROM sqlite_master WHERE type='index' AND name=? AND tbl_name=?")
    .get(name, collection) as { name: string; sql: string } | null;

  if (!row) {
    throw Object.assign(
      new Error(`Index "${name}" not found on collection "${collection}".`),
      { status: 404 }
    );
  }

  const pragmaRows = db
    .query(`PRAGMA index_info("${name}")`)
    .all() as { seqno: number; cid: number; name: string }[];

  const columns: IndexColumn[] = pragmaRows.map((p) => ({
    position: p.seqno,
    name: p.name,
  }));

  const unique = row.sql.toUpperCase().includes("CREATE UNIQUE INDEX");

  return {
    name: row.name,
    unique,
    userDefined: true,
    columns,
    sql: row.sql,
  };
}

/**
 * Drop an index from a collection.
 *
 * `DELETE /api/admin/:database/collections/:collection/indexes/:name`
 */
export function dropIndex(
  pool: DatabasePool,
  collection: string,
  name: string
): void {
  validateIdentifier(collection, "collection name");
  validateIdentifier(name, "index name");

  // Prevent dropping system indexes
  if (SYSTEM_INDEX_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    throw Object.assign(
      new Error(`Cannot drop system index "${name}".`),
      { status: 403 }
    );
  }

  pool.writeTransaction(() => {
    const db = pool.write();

    // Verify index exists
    const existing = db
      .query("SELECT 1 FROM sqlite_master WHERE type='index' AND name=? AND tbl_name=?")
      .get(name, collection);
    if (!existing) {
      throw Object.assign(
        new Error(`Index "${name}" not found on collection "${collection}".`),
        { status: 404 }
      );
    }

    db.run(`DROP INDEX IF EXISTS "${name}"`);
  });
}