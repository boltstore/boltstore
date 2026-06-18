import { DatabasePool } from "../db/pool";
import { toBindings } from "../db/cast";
import { applyRLS, toRLSContext } from "../rls";
import type { AuthContext } from "../middleware/auth";
import { getColumnNames } from "./schema-cache";

function countRecords(
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

export { countRecords };
