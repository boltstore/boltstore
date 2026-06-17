import { DatabasePool } from "../db/pool";
import { generateSecureId } from "@boltstore/utils";
import { toBindings } from "../db/cast";
import { applyRLS, toRLSContext, type RLSContext } from "../rls";
import type { AuthContext } from "../middleware/auth";
import { getColumnNames } from "./schema-cache";
import { now } from "./helpers";

function generateId(): string {
  return generateSecureId("rec");
}

function createRecord(
  pool: DatabasePool,
  collection: string,
  data: Record<string, unknown>,
  auth?: AuthContext
): Record<string, unknown> {
  const columns = getColumnNames(pool, collection);
  const systemCols = new Set(["id", "created_at", "updated_at"]);

  const id = (data.id as string) || generateId();
  const timestamp = now();

  const record: Record<string, unknown> = {
    id,
    created_at: (data.created_at as string) || timestamp,
    updated_at: timestamp,
  };

  for (const key of Object.keys(data)) {
    if (systemCols.has(key)) continue;
    record[key] = data[key];
  }

  const keys = Object.keys(record);
  const placeholders = keys.map(() => "?").join(", ");
  const quotedKeys = keys.map((k) => `"${k}"`).join(", ");
  const values = keys.map((k) => record[k]);

  return pool.writeTransaction(() => {
    const db = pool.write();

    db.run(
      `INSERT OR REPLACE INTO "${collection}" (${quotedKeys}) VALUES (${placeholders})`,
      toBindings(values)
    );

    const row = db.query(`SELECT * FROM "${collection}" WHERE id=?`).get(id);
    return row as Record<string, unknown>;
  });
}

function getRecord(
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

function updateRecord(
  pool: DatabasePool,
  collection: string,
  id: string,
  data: Record<string, unknown>,
  auth?: AuthContext
): Record<string, unknown> {
  const columns = getColumnNames(pool, collection);
  const columnSet = new Set(columns);
  const immutable = new Set(["id", "created_at"]);

  const userUpdates: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (immutable.has(key)) continue;
    if (!columnSet.has(key)) continue;
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

    const row = db.query(`SELECT * FROM "${collection}" WHERE id=?`).get(id);
    return row as Record<string, unknown>;
  });
}

function deleteRecord(
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

export { createRecord, getRecord, updateRecord, deleteRecord };
