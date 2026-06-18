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
): void {
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
