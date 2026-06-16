import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { ApiResponse, jsonResponse, errorResponse } from "../server";

export function registerDatabaseRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/admin/databases", () => {
    try {
      const databases = manager.listDatabases();
      return jsonResponse({ data: databases });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list databases";
      return errorResponse("DATABASES_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/databases", async (req) => {
    try {
      const { name } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      return jsonResponse({ data: manager.createDatabase(name) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create database";
      return errorResponse("CREATE_DATABASE_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.delete("/api/admin/databases/:database", (_req, params) => {
    try {
      manager.deleteDatabase(params.database);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete database";
      return errorResponse("DELETE_DATABASE_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}