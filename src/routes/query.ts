import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateApiKey } from "../middleware/auth";

export function registerQueryRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/databases/:db/query", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const body = await req.json() as { sql?: string; params?: any[] };
    if (!body.sql || typeof body.sql !== "string") {
      return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    }

    const pool = manager.get(params.db);
    const bindings = Array.isArray(body.params) ? body.params : [];

    try {
      const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|VACUUM)/i.test(body.sql.trim());
      if (isWrite) {
        const result = pool.write().run(body.sql, bindings);
        return jsonResponse({ data: null, meta: { changes: result.changes } });
      }
      const rows = pool.read().query(body.sql).all(...bindings);
      return jsonResponse({ data: rows });
    } catch (err: any) {
      return errorResponse("ERROR", err.message || "Query failed.", 400);
    }
  });
}
