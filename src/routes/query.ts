import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";
import { checkReadOnly } from "../middleware/readonly";
import { recordAnalytics } from "./analytics";
import { logger } from "../logger";
import { toBindings } from "../db/cast";

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA|REINDEX|ANALYZE)\b/i;
const SELECT_PATTERN = /^\s*(SELECT|WITH|EXPLAIN)\b/i;

function isSelectStatement(sql: string): boolean {
  return SELECT_PATTERN.test(sql.trim());
}

function isWriteStatement(sql: string): boolean {
  return WRITE_PATTERN.test(sql.trim());
}

export function registerQueryRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/databases/:db/query", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const start = performance.now();
    const body = await parseJsonBody<{ sql?: string; params?: unknown[] }>(req); if (body instanceof Response) return body;
    if (!body.sql || typeof body.sql !== "string") {
      return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    }

    const sql = body.sql;
    const isWrite = isWriteStatement(sql);

    if (isWrite) {
      const ro = checkReadOnly(manager, params.db);
      if (ro) return ro;
    }

    if (!auth.isAdmin && !isSelectStatement(sql)) {
      recordAnalytics(manager, { database: params.db, operation: "select", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: "Non-admin key attempted non-SELECT statement" });
      return errorResponse("WRITE_REQUIRES_ADMIN", "Non-admin API keys may only execute SELECT statements via /query. DDL, DML, PRAGMA, and ATTACH require an admin key.", 403);
    }

    const pool = manager.get(params.db);
    const bindings = toBindings(Array.isArray(body.params) ? body.params : []);

    try {
      if (isWrite) {
        const result = pool.write().run(sql, bindings);
        recordAnalytics(manager, { database: params.db, operation: "update", durationMs: performance.now() - start, rowCount: result.changes, status: "ok" });
        return jsonResponse({ data: null, meta: { changes: result.changes } });
      }
      const rows = pool.read().query(sql).all(...bindings);
      recordAnalytics(manager, { database: params.db, operation: "select", durationMs: performance.now() - start, rowCount: rows.length, status: "ok" });
      return jsonResponse({ data: rows });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Query endpoint error", { database: params.db, error: msg });
      recordAnalytics(manager, { database: params.db, operation: "select", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: msg });
      return errorResponse("QUERY_ERROR", "Query execution failed. Check your SQL syntax or constraints.", 400);
    }
  });
}
