import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createView, listViews, getView, queryView, dropView } from "../admin/views";
import { jsonResponse, errorResponse } from "../server";

export function registerViewRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/admin/:database/views", async (req, params) => {
    try {
      const { name, sql } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: createView(pool, name, sql) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create view";
      return errorResponse("CREATE_VIEW_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/admin/:database/views", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: listViews(pool) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list views";
      return errorResponse("LIST_VIEWS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/admin/:database/views/:name", (req, params) => {
    try {
      const url = new URL(req.url);
      const pool = manager.get(params.database);
      const isQuery = url.searchParams.get("query") === "true";
      if (isQuery) {
        const options: { filter?: Record<string,unknown>; sort?: string; direction?: "asc"|"desc"; limit?: number; offset?: number } = {};
        for (const [key, value] of url.searchParams.entries()) {
          if (key === "query") continue;
          if (key === "sort") options.sort = value;
          else if (key === "direction") options.direction = value as "asc"|"desc";
          else if (key === "limit") options.limit = parseInt(value, 10);
          else if (key === "offset") options.offset = parseInt(value, 10);
          else { if (!options.filter) options.filter = {}; options.filter[key] = value; }
        }
        return jsonResponse({ data: queryView(pool, params.name, options) });
      }
      return jsonResponse({ data: getView(pool, params.name) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get view";
      return errorResponse("GET_VIEW_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.delete("/api/admin/:database/views/:name", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      dropView(pool, params.name);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to drop view";
      return errorResponse("DROP_VIEW_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}