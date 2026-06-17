/**
 * Relations / References — lightweight foreign key relations for Boltstore.
 *
 * Adds support for:
 * - `expand` parameter to fetch related records by foreign key
 * - Reference field type in schema with optional cascade delete
 *
 * @module boltstore/relations
 */

import { DatabasePool } from "./db/pool";
import { validateIdentifier } from "@boltstore/utils";
import type { AuthContext } from "./middleware/auth";

/** Maximum recursion depth for nested expansion. */
const MAX_EXPAND_DEPTH = 2;

/** Metadata for a single relation field. */
export interface RelationDefinition {
  /** The column in this collection that holds the foreign key. */
  field: string;
  /** The target collection (table) that records reference. */
  foreignCollection: string;
  /** Whether deleting a record in this collection cascades to children (Phase 1 feature). */
  cascadeDelete?: boolean;
}

/** Resolve a target collection for an expand field using relation metadata first, then heuristic. */
function resolveTargetCollection(pool: DatabasePool, parentCollection: string, field: string): string | null {
  // 1. Try explicit relation metadata stored in _collections
  try {
    const db = pool.read();
    const meta = db
      .query("SELECT relations_json FROM _collections WHERE name = ?")
      .get(parentCollection) as { relations_json?: string } | null;
    if (meta?.relations_json) {
      const relations = JSON.parse(meta.relations_json) as Record<string, { foreignCollection: string }>;
      if (relations[field]?.foreignCollection) {
        return relations[field].foreignCollection;
      }
    }
  } catch {
    // _collections may not exist yet; fall through to heuristic.
  }

  // 2. Heuristic pluralization
  let targetCollection = `${field}s`;
  if (field.endsWith("y")) {
    targetCollection = field.slice(0, -1) + "ies";
  } else if (field.endsWith("s") || field.endsWith("x") || field.endsWith("ch") || field.endsWith("sh")) {
    targetCollection = field + "es";
  }

  try {
    validateIdentifier(targetCollection, "target collection");
    return targetCollection;
  } catch {
    return null;
  }
}

/** Load explicit relation definitions for a collection from metadata. */
export function getRelations(pool: DatabasePool, collection: string): Record<string, RelationDefinition> {
  try {
    const db = pool.read();
    const meta = db
      .query("SELECT relations_json FROM _collections WHERE name = ?")
      .get(collection) as { relations_json?: string } | null;
    if (meta?.relations_json) {
      return JSON.parse(meta.relations_json) as Record<string, RelationDefinition>;
    }
  } catch {
    // ignore
  }
  return {};
}

/** Persist explicit relation definitions for a collection. */
export function setRelations(
  pool: DatabasePool,
  collection: string,
  relations: Record<string, RelationDefinition>
): void {
  const db = pool.write();
  try {
    db.run("ALTER TABLE _collections ADD COLUMN relations_json TEXT");
  } catch {
    // Column may already exist.
  }
  db.run("UPDATE _collections SET relations_json = ? WHERE name = ?", [JSON.stringify(relations), collection]);
}

/**
 * Expand related records for a list of parent records.
 *
 * For each record, if it has a field whose name is provided in `expandFields`,
 * the function fetches the related record from the target collection and nests
 * it under the key `{field}_expanded`.
 *
 * Example:
 * ```
 * GET /api/myapp/collections/posts/records?expand=author
 * ```
 * If `posts` has an `author` column storing user IDs, the returned records
 * will include `author_expanded: { id, name, ... }`.
 */
export function expandRecords(
  pool: DatabasePool,
  parentCollection: string,
  records: Record<string, unknown>[],
  expandFields: string[],
  _depth = 0
): Record<string, unknown>[] {
  if (!Array.isArray(records) || records.length === 0) return records;
  if (!Array.isArray(expandFields) || expandFields.length === 0) return records;
  if (_depth >= MAX_EXPAND_DEPTH) return records;

  const expanded = records.map((r) => ({ ...r }));

  for (const field of expandFields) {
    validateIdentifier(field, "field name");

    const targetCollection = resolveTargetCollection(pool, parentCollection, field);
    if (!targetCollection) continue;

    // Group parent IDs to fetch in batch
    const foreignIds = new Set<string>();
    for (const record of records) {
      const foreignId = record[field];
      if (foreignId !== null && foreignId !== undefined && typeof foreignId === "string") {
        foreignIds.add(foreignId);
      }
    }

    if (foreignIds.size === 0) continue;

    // Fetch related records
    const db = pool.read();

    // Check if the target collection exists
    const tableExists = db
      .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(targetCollection);
    if (!tableExists) {
      // Still set explicit null for non-existent heuristic targets so callers see a deterministic key.
      for (const record of expanded) {
        record[`${field}_expanded`] = null;
      }
      continue;
    }

    // Build batch query
    const placeholders = Array.from(foreignIds).map(() => "?").join(", ");
    const relatedRows = db
      .query(`SELECT * FROM "${targetCollection}" WHERE id IN (${placeholders})`)
      .all(...Array.from(foreignIds)) as Record<string, unknown>[];

    // Build a map for O(1) lookup
    const relatedMap = new Map<string, Record<string, unknown>>();
    for (const row of relatedRows) {
      relatedMap.set(row.id as string, row);
    }

    // Attach expanded data
    for (const record of expanded) {
      const foreignId = record[field] as string | undefined;
      const expandKey = `${field}_expanded`;
      if (foreignId && relatedMap.has(foreignId)) {
        record[expandKey] = relatedMap.get(foreignId);
      } else {
        record[expandKey] = null;
      }
    }
  }

  return expanded;
}

/**
 * Cascade delete: when a parent record is deleted, also delete child records
 * that reference it via a foreign key field.
 *
 * Checks all collections in the database for a field matching `{parentCollection}_id`
 * and deletes records where that field equals the deleted `parentId`.
 */
export function cascadeDelete(
  pool: DatabasePool,
  parentCollection: string,
  parentId: string,
  _auth?: AuthContext
): { deleted: string[] } {
  validateIdentifier(parentCollection, "collection name");
  const deleted: string[] = [];

  pool.writeTransaction(() => {
    const db = pool.write();

    // Find all tables that have a column named {parentCollection}_id
    const allTables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    for (const table of allTables) {
      const foreignKey = `${parentCollection}_id`;

      // Check if this table has the foreign key column via PRAGMA
      const columns = db
        .query(`PRAGMA table_info("${table.name}")`)
        .all() as { name: string }[];
      const hasColumn = columns.some((c) => c.name === foreignKey);

      if (hasColumn) {
        db.run(`DELETE FROM "${table.name}" WHERE "${foreignKey}" = ?`, [parentId]);
        deleted.push(table.name);
      }
    }
  });

  return { deleted };
}