import { DatabasePool } from "../db/pool";
import { generateSecureId } from "@boltstore/utils";
import { toBindings } from "../db/cast";
import { applyRLS, toRLSContext } from "../rls";
import type { AuthContext } from "../middleware/auth";
import { getColumnNames } from "./schema-cache";
import { now } from "./helpers";

function generateId(): string {
  return generateSecureId("rec");
}

function batchRecords(
  pool: DatabasePool,
  collection: string,
  operations: { action: "create" | "update" | "delete"; id?: string; data?: Record<string, unknown> }[],
  auth?: AuthContext
): { created: number; updated: number; deleted: number } {
  const columns = getColumnNames(pool, collection);
  const columnSet = new Set(columns);

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
          if (data.id) {
            let checkSql = `SELECT 1 FROM "${collection}" WHERE id=?`;
            const checkParams: unknown[] = [data.id];
            if (rls?.whereClause) {
              checkSql += ` AND ${rls.whereClause}`;
              checkParams.push(...rls.params);
            }
            const existing = db.query(checkSql).get(...toBindings(checkParams));
            if (existing) {
              throw Object.assign(
                new Error(`Record "${data.id}" already exists in collection "${collection}".`),
                { status: 409 }
              );
            }
          }
          const record: Record<string, unknown> = {
            id,
            created_at: (data.created_at as string) || timestamp,
            updated_at: timestamp,
          };
          for (const [k, v] of Object.entries(data)) {
            if (k === "id" || k === "created_at" || k === "updated_at") continue;
            if (!columnSet.has(k)) continue;
            record[k] = v;
          }
          const keys = Object.keys(record);
          const placeholders = keys.map(() => "?").join(", ");
          const quotedKeys = keys.map((k) => `"${k}"`).join(", ");
          const values = keys.map((k) => record[k]);
          db.run(
            `INSERT INTO "${collection}" (${quotedKeys}) VALUES (${placeholders})`,
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
            if (!columnSet.has(k)) continue;
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

export { batchRecords };
