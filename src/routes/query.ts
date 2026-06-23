import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";
import { checkReadOnly } from "../middleware/readonly";
import { recordAnalytics } from "./analytics";

export function registerQueryRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/databases/:db/query", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const start = performance.now();
    const body = await req.json() as { sql?: string; params?: any[] };
    if (!body.sql || typeof body.sql !== "string") {
      return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    }

    const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|VACUUM)/i.test(body.sql.trim());
    if (isWrite) {
      const ro = checkReadOnly(manager, params.db);
      if (ro) return ro;
    }

    const pool = manager.get(params.db);
    const bindings = Array.isArray(body.params) ? body.params : [];

    try {
      const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|VACUUM)/i.test(body.sql.trim());
      if (isWrite) {
        const result = pool.write().run(body.sql, bindings);
        recordAnalytics(manager, { database: params.db, operation: isWrite ? "update" : "select", durationMs: performance.now() - start, rowCount: result.changes, status: "ok" });
        return jsonResponse({ data: null, meta: { changes: result.changes } });
      }
      const rows = pool.read().query(body.sql).all(...bindings);
      recordAnalytics(manager, { database: params.db, operation: "select", durationMs: performance.now() - start, rowCount: rows.length, status: "ok" });
      return jsonResponse({ data: rows });
    } catch (err: any) {
      recordAnalytics(manager, { database: params.db, operation: "select", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: err.message });
      return errorResponse("ERROR", err.message || "Query failed.", 400);
    }
  });
}
