import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { executeReadQuery, executeWriteQuery, explainQuery } from "../admin/query";
import { jsonResponse, errorResponse } from "../server";

export function registerAdminQueryRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/admin/:database/query", async (req, params) => {
    try {
      const { sql, params: queryParams } = await req.json();
      if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: executeReadQuery(pool, sql, Array.isArray(queryParams) ? queryParams : []) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to execute query";
      return errorResponse("RAW_QUERY_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/query/write", async (req, params) => {
    try {
      const { sql, params: queryParams } = await req.json();
      if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: executeWriteQuery(pool, sql, Array.isArray(queryParams) ? queryParams : []) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to execute write query";
      return errorResponse("RAW_WRITE_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/query/explain", async (req, params) => {
    try {
      const { sql, params: queryParams } = await req.json();
      if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: explainQuery(pool, sql, Array.isArray(queryParams) ? queryParams : []) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to explain query";
      return errorResponse("EXPLAIN_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}