import { DatabasePool } from "../db/pool";
import { validateIdentifier } from "@boltstore/utils";

const MAX_LIMIT = 1000;
const MAX_OFFSET = 100000;

interface SchemaCacheEntry {
  columns: string[];
  columnTypes: Map<string, string>;
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

function fetchColumns(pool: DatabasePool, collection: string): SchemaCacheEntry {
  validateIdentifier(collection, "collection name");
  const db = pool.read();
  const existsRow = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(collection);
  if (!existsRow) {
    return { columns: [], columnTypes: new Map(), exists: false, fetchedAt: Date.now() };
  }
  const rows = db.query(`PRAGMA table_info("${collection}")`).all() as { name: string; type: string }[];
  const columnTypes = new Map<string, string>();
  for (const r of rows) {
    columnTypes.set(r.name, r.type.toUpperCase());
  }
  return { columns: rows.map((r) => r.name), columnTypes, exists: true, fetchedAt: Date.now() };
}

export function getColumnTypes(pool: DatabasePool, collection: string): Map<string, string> {
  const cache = getPoolCache(pool);
  const entry = cache.get(collection);
  if (entry && Date.now() - entry.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return entry.columnTypes;
  }
  const fresh = fetchColumns(pool, collection);
  cache.set(collection, fresh);
  return fresh.columnTypes;
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

function invalidateSchemaCache(pool: DatabasePool, collection?: string): void {
  const cache = schemaCache.get(pool);
  if (!cache) return;
  if (collection) {
    cache.delete(collection);
  } else {
    cache.clear();
  }
}

function collectionExists(pool: DatabasePool, collection: string): boolean {
  const cache = getPoolCache(pool);
  const entry = cache.get(collection);
  if (entry && Date.now() - entry.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return entry.exists;
  }
  const fresh = fetchColumns(pool, collection);
  cache.set(collection, fresh);
  return fresh.exists;
}

export { invalidateSchemaCache, getColumnNames, collectionExists, MAX_LIMIT, MAX_OFFSET };
