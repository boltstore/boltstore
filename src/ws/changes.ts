import { DatabasePool } from "../db/pool";
import { generateSecureId } from "@boltstore/utils";
import { toBindings } from "../db/cast";

export function bootstrapChangesTable(pool: DatabasePool): void {
  const db = pool.write();
  db.run(`
    CREATE TABLE IF NOT EXISTS _changes (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      collection TEXT NOT NULL,
      record_id TEXT,
      record_json TEXT,
      previous_json TEXT,
      principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_changes_created_at ON _changes(created_at)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_changes_collection ON _changes(collection)
  `);
}

export function persistChange(
  pool: DatabasePool,
  event: "create" | "update" | "delete",
  collection: string,
  record: Record<string, unknown>,
  previous?: Record<string, unknown>,
  principalId?: string
): number {
  bootstrapChangesTable(pool);
  const id = generateSecureId("chg");
  const recordId = (record.id as string) || null;
  const db = pool.write();
  db.run(
    `INSERT INTO _changes (id, event, collection, record_id, record_json, previous_json, principal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      event,
      collection,
      recordId,
      JSON.stringify(record),
      previous ? JSON.stringify(previous) : null,
      principalId || null,
    ]
  );
  const row = db.query("SELECT last_insert_rowid() as seq").get() as { seq: number };
  return row.seq;
}

export function listChanges(
  pool: DatabasePool,
  options: {
    collection?: string;
    since?: string;
    limit?: number;
    offset?: number;
  } = {}
): { id: string; event: string; collection: string; recordId: string | null; record: Record<string, unknown>; previous: Record<string, unknown> | null; principalId: string | null; createdAt: string }[] {
  bootstrapChangesTable(pool);
  const conditions: string[] = [];
  const params: unknown[] = [];
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  if (options.collection) {
    conditions.push("collection = ?");
    params.push(options.collection);
  }
  if (options.since) {
    conditions.push("created_at > ?");
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = pool.read();
  const stmt = db.query(`SELECT id, event, collection, record_id, record_json, previous_json, principal_id, created_at FROM _changes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const allParams = [...params, limit, offset];
  const rows = stmt.all(...toBindings(allParams)) as { id: string; event: string; collection: string; record_id: string | null; record_json: string; previous_json: string | null; principal_id: string | null; created_at: string }[];

  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    collection: r.collection,
    recordId: r.record_id,
    record: JSON.parse(r.record_json),
    previous: r.previous_json ? JSON.parse(r.previous_json) : null,
    principalId: r.principal_id,
    createdAt: r.created_at,
  }));
}

export interface SyncChange {
  id: string;
  seq: number;
  event: string;
  collection: string;
  recordId: string | null;
  record: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  principalId: string | null;
  createdAt: string;
}

export function listChangesSince(
  pool: DatabasePool,
  options: {
    cursor?: number;
    collection?: string;
    limit?: number;
  } = {}
): { changes: SyncChange[]; cursor: number | null; hasMore: boolean } {
  bootstrapChangesTable(pool);
  const conditions: string[] = [];
  const params: unknown[] = [];
  const limit = options.limit ?? 100;

  if (options.collection) {
    conditions.push("collection = ?");
    params.push(options.collection);
  }
  if (options.cursor != null) {
    conditions.push("rowid > ?");
    params.push(options.cursor);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = pool.read();
  const rows = db.query(`SELECT rowid AS seq, id, event, collection, record_id, record_json, previous_json, principal_id, created_at FROM _changes ${where} ORDER BY rowid ASC LIMIT ?`).all(...toBindings([...params, limit + 1])) as { seq: number; id: string; event: string; collection: string; record_id: string | null; record_json: string; previous_json: string | null; principal_id: string | null; created_at: string }[];

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const changes: SyncChange[] = rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    event: r.event,
    collection: r.collection,
    recordId: r.record_id,
    record: JSON.parse(r.record_json),
    previous: r.previous_json ? JSON.parse(r.previous_json) : null,
    principalId: r.principal_id,
    createdAt: r.created_at,
  }));

  const cursor = changes.length > 0 ? changes[changes.length - 1].seq : null;
  return { changes, cursor, hasMore };
}

export function bootstrapSyncStateTable(pool: DatabasePool): void {
  pool.write().run(`
    CREATE TABLE IF NOT EXISTS _sync_state (
      client_id TEXT PRIMARY KEY,
      cursor INTEGER,
      last_sync_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function getSyncState(pool: DatabasePool, clientId: string): { clientId: string; cursor: number | null; lastSyncAt: string } | null {
  bootstrapSyncStateTable(pool);
  const row = pool.read().query("SELECT client_id, cursor, last_sync_at FROM _sync_state WHERE client_id=?").get(clientId) as { client_id: string; cursor: number | null; last_sync_at: string } | null;
  if (!row) return null;
  return { clientId: row.client_id, cursor: row.cursor, lastSyncAt: row.last_sync_at };
}

export function upsertSyncState(pool: DatabasePool, clientId: string, cursor: number | null): void {
  bootstrapSyncStateTable(pool);
  pool.write().run(
    `INSERT INTO _sync_state (client_id, cursor, last_sync_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(client_id) DO UPDATE SET cursor=excluded.cursor, last_sync_at=excluded.last_sync_at`,
    [clientId, cursor]
  );
}
