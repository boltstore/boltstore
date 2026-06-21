import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 50;

function buildWhereClause(filter: Record<string, any>, params: any[]): string {
  const clauses: string[] = [];

  for (const [key, val] of Object.entries(filter)) {
    if (key === "$and" && Array.isArray(val)) {
      const parts = val.map((sub: any) => buildWhereClause(sub, params));
      clauses.push(`(${parts.join(" AND ")})`);
    } else if (key === "$or" && Array.isArray(val)) {
      const parts = val.map((sub: any) => buildWhereClause(sub, params));
      clauses.push(`(${parts.join(" OR ")})`);
    } else if (typeof val === "object" && val !== null) {
      for (const [op, operand] of Object.entries(val)) {
        switch (op) {
          case "$eq": clauses.push(`"${key}" = ?`); params.push(operand); break;
          case "$ne": clauses.push(`"${key}" != ?`); params.push(operand); break;
          case "$gt": clauses.push(`"${key}" > ?`); params.push(operand); break;
          case "$gte": clauses.push(`"${key}" >= ?`); params.push(operand); break;
          case "$lt": clauses.push(`"${key}" < ?`); params.push(operand); break;
          case "$lte": clauses.push(`"${key}" <= ?`); params.push(operand); break;
          case "$in": {
            const arr = Array.isArray(operand) ? operand : String(operand).split(",");
            const placeholders = arr.map(() => "?").join(",");
            clauses.push(`"${key}" IN (${placeholders})`);
            params.push(...arr);
            break;
          }
          case "$like": clauses.push(`"${key}" LIKE ?`); params.push(operand); break;
          case "$glob": clauses.push(`"${key}" GLOB ?`); params.push(operand); break;
        }
      }
    } else {
      clauses.push(`"${key}" = ?`);
      params.push(val);
    }
  }

  return clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
}

function buildSelectSQL(table: string, query: URLSearchParams): { sql: string; params: any[]; countSql: string } {
  const params: any[] = [];
  const selects: string[] = [];

  // Fields
  const fields = query.getAll("fields");
  const selectExpr = fields.length > 0 ? fields.map(f => `"${f}"`).join(", ") : "*";

  // Filter
  let filter: Record<string, any> = {};
  try {
    const filterParam = query.get("filter");
    if (filterParam) filter = JSON.parse(filterParam);
  } catch {}
  const where = buildWhereClause(filter, params);

  // Search
  const search = query.get("search");
  let searchClause = "";
  if (search) {
    searchClause = ` AND (${fields.length > 0 ? fields.map(f => `"${f}" LIKE ?`).join(" OR ") : `* LIKE ?`})`;
    params.push(`%${search}%`);
  }

  // Sort
  const sort = query.get("sort");
  let orderBy = "";
  if (sort) {
    const parts = sort.split(",").map(s => s.trim()).filter(Boolean);
    const orders = parts.map(p => {
      if (p.startsWith("-")) return `"${p.slice(1)}" DESC`;
      if (p.startsWith("+")) return `"${p.slice(1)}" ASC`;
      return `"${p}" ASC`;
    });
    orderBy = ` ORDER BY ${orders.join(", ")}`;
  }

  // Pagination
  const limit = Math.min(parseInt(query.get("limit") || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
  const offset = parseInt(query.get("offset") || "0", 10);

  const sql = `SELECT ${selectExpr} FROM "${table}"${where}${searchClause}${orderBy} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as total FROM "${table}"${where}${searchClause}`;
  params.push(limit, offset);

  return { sql, params, countSql };
}

export function registerRecordRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/databases/:db/tables/:table/records", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const body = await req.json();
    const pool = manager.get(params.db);
    const db = pool.write();

    const records = Array.isArray(body) ? body : [body];
    const inserted: any[] = [];

    for (const record of records) {
      const keys = Object.keys(record);
      const placeholders = keys.map(() => "?").join(", ");
      const cols = keys.map(k => `"${k}"`).join(", ");
      const vals = keys.map(k => record[k]);

      try {
        db.run(`INSERT INTO "${params.table}" (${cols}) VALUES (${placeholders})`, vals);
        const lastId = (db.query("SELECT last_insert_rowid() as id").get() as any).id;
        const insertedRow = pool.read().query(`SELECT rowid, * FROM "${params.table}" WHERE rowid = ?`).get(lastId);
        inserted.push(insertedRow || record);
      } catch (err: any) {
        return errorResponse("ERROR", err.message || "Failed to insert record.", 400);
      }
    }

    return jsonResponse({ data: records.length === 1 ? inserted[0] : inserted }, 201);
  });

  router.get("/api/databases/:db/tables/:table/records", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const url = new URL(req.url);
    const query = url.searchParams;
    const pool = manager.get(params.db);
    const readDb = pool.read();

    const { sql, countSql, params: bindParams } = buildSelectSQL(params.table, query);
    const total = (readDb.query(countSql).get(...bindParams.slice(0, -2)) as any)?.total ?? 0;
    const rows = readDb.query(sql).all(...bindParams) as any[];

    const limit = Math.min(parseInt(query.get("limit") || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
    const offset = parseInt(query.get("offset") || "0", 10);

    return jsonResponse({
      data: rows,
      meta: { total, limit, offset },
    });
  });

  router.get("/api/databases/:db/tables/:table/records/:id", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const pool = manager.get(params.db);
    const row = pool.read().query(`SELECT rowid, * FROM "${params.table}" WHERE rowid = ?`).get(params.id);
    if (!row) return errorResponse("NOT_FOUND", "Record not found.", 404);
    return jsonResponse({ data: row });
  });

  router.patch("/api/databases/:db/tables/:table/records/:id", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const body = await req.json() as Record<string, any>;
    const keys = Object.keys(body);
    if (keys.length === 0) return errorResponse("VALIDATION", "No fields to update.", 400);

    const setClause = keys.map(k => `"${k}" = ?`).join(", ");
    const vals = keys.map(k => body[k]);
    vals.push(params.id);

    const pool = manager.get(params.db);
    try {
      pool.write().run(`UPDATE "${params.table}" SET ${setClause} WHERE rowid = ?`, vals);
      const updated = pool.read().query(`SELECT rowid, * FROM "${params.table}" WHERE rowid = ?`).get(params.id);
      return jsonResponse({ data: updated });
    } catch (err: any) {
      return errorResponse("ERROR", err.message || "Failed to update record.", 400);
    }
  });

  router.delete("/api/databases/:db/tables/:table/records/:id", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const pool = manager.get(params.db);
    pool.write().run(`DELETE FROM "${params.table}" WHERE rowid = ?`, [params.id]);
    return jsonResponse({ data: { deleted: true } });
  });
}
