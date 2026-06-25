import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";
import { checkReadOnly } from "../middleware/readonly";
import { recordAnalytics } from "./analytics";
import { logger } from "../logger";
import { toBindings } from "../db/cast";
import { isValidIdentifier, validateIdentifier, validateIdentifiers } from "../validation";
import { MAX_RECORD_LIMIT, DEFAULT_RECORD_LIMIT } from "../validation";

const MAX_LIMIT = MAX_RECORD_LIMIT;
const DEFAULT_LIMIT = DEFAULT_RECORD_LIMIT;

const SUPPORTED_OPS = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$like", "$glob"]);

function buildWhereClause(filter: Record<string, unknown>, params: unknown[], path = "filter"): string {
  const clauses: string[] = [];

  for (const [key, val] of Object.entries(filter)) {
    if (key === "$and" && Array.isArray(val)) {
      const parts = val.map((sub: unknown, i: number) => buildWhereClause(sub as Record<string, unknown>, params, `${path}[$and][${i}]`));
      clauses.push(`(${parts.join(" AND ")})`);
    } else if (key === "$or" && Array.isArray(val)) {
      const parts = val.map((sub: unknown, i: number) => buildWhereClause(sub as Record<string, unknown>, params, `${path}[$or][${i}]`));
      clauses.push(`(${parts.join(" OR ")})`);
    } else if (typeof val === "object" && val !== null) {
      if (!isValidIdentifier(key)) {
        throw new FilterValidationError(`Invalid column name in filter: "${key}" at ${path}`);
      }
      for (const [op, operand] of Object.entries(val as Record<string, unknown>)) {
        if (!SUPPORTED_OPS.has(op)) {
          throw new FilterValidationError(`Unsupported filter operator "${op}" at ${path}.${key}`);
        }
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
      if (!isValidIdentifier(key)) {
        throw new FilterValidationError(`Invalid column name in filter: "${key}" at ${path}`);
      }
      clauses.push(`"${key}" = ?`);
      params.push(val);
    }
  }

  return clauses.join(" AND ");
}

class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterValidationError";
  }
}

function buildSelectSQL(table: string, query: URLSearchParams): { sql: string; params: unknown[]; countSql: string } | Response {
  const params: unknown[] = [];

  const fields = query.getAll("fields");
  if (fields.length > 0) {
    const fieldErr = validateIdentifiers(fields, "column");
    if (fieldErr) return fieldErr;
  }
  const selectExpr = fields.length > 0 ? fields.map(f => `"${f}"`).join(", ") : "*";

  let filter: Record<string, unknown> = {};
  try {
    const filterParam = query.get("filter");
    if (filterParam) filter = JSON.parse(filterParam);
  } catch {
    return errorResponse("INVALID_FILTER", "Filter must be valid JSON.", 400);
  }

  let where: string;
  try {
    where = buildWhereClause(filter, params);
  } catch (err) {
    if (err instanceof FilterValidationError) {
      return errorResponse("INVALID_FILTER", err.message, 400);
    }
    throw err;
  }
  const wherePrefix = where ? ` WHERE ${where}` : "";

  const search = query.get("search");
  let searchClause = "";
  if (search) {
    if (fields.length === 0) {
      return errorResponse("VALIDATION", "Search requires 'fields' to be specified (searching all columns is not supported).", 400);
    }
    searchClause = `${where ? " AND" : " WHERE"} (${fields.map(f => `"${f}" LIKE ?`).join(" OR ")})`;
    params.push(`%${search}%`);
  }

  const sort = query.get("sort");
  let orderBy = "";
  if (sort) {
    const parts = sort.split(",").map(s => s.trim()).filter(Boolean);
    const sortFields: string[] = [];
    for (const p of parts) {
      const name = p.startsWith("-") || p.startsWith("+") ? p.slice(1) : p;
      const sortErr = validateIdentifier(name, "column");
      if (sortErr) return sortErr;
      if (p.startsWith("-")) sortFields.push(`"${name}" DESC`);
      else if (p.startsWith("+")) sortFields.push(`"${name}" ASC`);
      else sortFields.push(`"${name}" ASC`);
    }
    orderBy = ` ORDER BY ${sortFields.join(", ")}`;
  }

  const limit = Math.min(parseInt(query.get("limit") || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
  const offset = parseInt(query.get("offset") || "0", 10);

  const sql = `SELECT ${selectExpr} FROM "${table}"${wherePrefix}${searchClause}${orderBy} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as total FROM "${table}"${wherePrefix}${searchClause}`;
  params.push(limit, offset);

  return { sql, params, countSql };
}

export function registerRecordRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/databases/:db/tables/:table/records", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const start = performance.now();
    const body = await parseJsonBody(req); if (body instanceof Response) return body;
    const pool = manager.get(params.db);
    const db = pool.write();

    const records = Array.isArray(body) ? body : [body];
    const inserted: Record<string, unknown>[] = [];
    const firstKeys = Object.keys(records[0] || {});
    const insertSql = `INSERT INTO "${params.table}" (${firstKeys.map(k => `"${k}"`).join(", ")}) VALUES (${firstKeys.map(() => "?").join(", ")})`;

    for (const record of records) {
      const keys = Object.keys(record);
      const colErr = validateIdentifiers(keys, "column");
      if (colErr) return colErr;
      const placeholders = keys.map(() => "?").join(", ");
      const cols = keys.map(k => `"${k}"`).join(", ");
      const vals = keys.map(k => record[k]);

      try {
        db.run(`INSERT INTO "${params.table}" (${cols}) VALUES (${placeholders})`, vals);
        const lastId = (db.query("SELECT last_insert_rowid() as id").get() as { id: number | bigint }).id;
        const insertedRow = pool.read().query(`SELECT rowid, * FROM "${params.table}" WHERE rowid = ?`).get(lastId);
        inserted.push(insertedRow || record);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("Record insert failed", { database: params.db, table: params.table, error: msg });
        recordAnalytics(manager, { database: params.db, table: params.table, operation: "insert", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: msg, sqlText: insertSql });
        return errorResponse("INSERT_ERROR", "Failed to insert record. Check your data and table schema.", 400);
      }
    }

    recordAnalytics(manager, { database: params.db, table: params.table, operation: "insert", durationMs: performance.now() - start, rowCount: records.length, status: "ok", sqlText: insertSql });
    return jsonResponse({ data: records.length === 1 ? inserted[0] : inserted }, 201);
  });

  router.get("/api/databases/:db/tables/:table/records", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const start = performance.now();
    const url = new URL(req.url);
    const query = url.searchParams;
    const pool = manager.get(params.db);
    const readDb = pool.read();

    const result = buildSelectSQL(params.table, query);
    if (result instanceof Response) return result;
    const { sql, countSql, params: bindParams } = result;
    // COUNT and SELECT run on the same read connection sequentially.
    // Between the two queries a write could change row count, causing total
    // to not match rows.length. Acceptable for an analytics-ish API —
    // full consistency would require a read transaction on the read connection.
    const total = (readDb.query(countSql).get(...toBindings(bindParams.slice(0, -2))) as { total?: number })?.total ?? 0;
    const rows = readDb.query(sql).all(...toBindings(bindParams)) as Record<string, unknown>[];

    const limit = Math.min(parseInt(query.get("limit") || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
    const offset = parseInt(query.get("offset") || "0", 10);

    recordAnalytics(manager, { database: params.db, table: params.table, operation: "select", durationMs: performance.now() - start, rowCount: rows.length, status: "ok", sqlText: sql });
    return jsonResponse({
      data: rows,
      meta: { total, limit, offset },
    });
  });

  router.get("/api/databases/:db/tables/:table/records/:id", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const start = performance.now();
    const pool = manager.get(params.db);
    const getSql = `SELECT rowid, * FROM "${params.table}" WHERE rowid = ?`;
    const row = pool.read().query(getSql).get(params.id);
    if (!row) {
      recordAnalytics(manager, { database: params.db, table: params.table, operation: "select", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: "Record not found", sqlText: getSql });
      return errorResponse("NOT_FOUND", "Record not found.", 404);
    }
    recordAnalytics(manager, { database: params.db, table: params.table, operation: "select", durationMs: performance.now() - start, rowCount: 1, status: "ok", sqlText: getSql });
    return jsonResponse({ data: row });
  });

  router.patch("/api/databases/:db/tables/:table/records/:id", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const start = performance.now();
    const body = await parseJsonBody<Record<string, unknown>>(req); if (body instanceof Response) return body;
    const keys = Object.keys(body);
    if (keys.length === 0) return errorResponse("VALIDATION", "No fields to update.", 400);
    const colErr = validateIdentifiers(keys, "column");
    if (colErr) return colErr;

    const setClause = keys.map(k => `"${k}" = ?`).join(", ");
    const vals = keys.map(k => body[k]);
    vals.push(params.id);
    const updateSql = `UPDATE "${params.table}" SET ${setClause} WHERE rowid = ?`;

    const pool = manager.get(params.db);
    try {
      pool.write().run(updateSql, toBindings(vals));
      const updated = pool.read().query(`SELECT rowid, * FROM "${params.table}" WHERE rowid = ?`).get(params.id);
      recordAnalytics(manager, { database: params.db, table: params.table, operation: "update", durationMs: performance.now() - start, rowCount: 1, status: "ok", sqlText: updateSql });
      return jsonResponse({ data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Record update failed", { database: params.db, table: params.table, error: msg });
      recordAnalytics(manager, { database: params.db, table: params.table, operation: "update", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: msg, sqlText: updateSql });
      return errorResponse("UPDATE_ERROR", "Failed to update record. Check your data and table schema.", 400);
    }
  });

  router.delete("/api/databases/:db/tables/:table/records/:id", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const start = performance.now();
    const pool = manager.get(params.db);
    const deleteSql = `DELETE FROM "${params.table}" WHERE rowid = ?`;
    pool.write().run(deleteSql, [params.id]);
    recordAnalytics(manager, { database: params.db, table: params.table, operation: "delete", durationMs: performance.now() - start, rowCount: 1, status: "ok", sqlText: deleteSql });
    return jsonResponse({ data: { deleted: true } });
  });
}