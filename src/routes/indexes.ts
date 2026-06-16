import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createIndex, listIndexes, dropIndex, type IndexDefinition } from "../indexes";
import { jsonResponse, errorResponse } from "../server";

export function registerIndexRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/admin/:database/collections/:collection/indexes", async (req, params) => {
    try {
      const { name, columns, unique } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: createIndex(pool, params.collection, name, { columns, unique } as IndexDefinition) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create index";
      return errorResponse("CREATE_INDEX_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/admin/:database/collections/:collection/indexes", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: listIndexes(pool, params.collection) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list indexes";
      return errorResponse("LIST_INDEXES_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.delete("/api/admin/:database/collections/:collection/indexes/:name", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      dropIndex(pool, params.collection, params.name);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to drop index";
      return errorResponse("DROP_INDEX_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}