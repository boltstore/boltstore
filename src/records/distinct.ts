import { DatabasePool } from "../db/pool";
import { validateIdentifier } from "@boltstore/utils";
import { toBindings } from "../db/cast";
import { applyRLS, toRLSContext, type RLSContext } from "../rls";
import type { AuthContext } from "../middleware/auth";
import { getColumnNames } from "./schema-cache";

function distinctValues(
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

export { distinctValues };
