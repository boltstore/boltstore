import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { listMigrations, applyMigrations, rollbackLastMigration } from "../migrations";
import { jsonResponse, errorResponse } from "../server";

export function registerMigrationRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/admin/:database/migrations", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: listMigrations(pool) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list migrations";
      return errorResponse("MIGRATIONS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/migrations/up", async (req, params) => {
    try {
      const { migrationDir } = await req.json();
      if (!migrationDir || typeof migrationDir !== "string") return errorResponse("VALIDATION", "Field 'migrationDir' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: await applyMigrations(pool, migrationDir) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to apply migrations";
      return errorResponse("APPLY_MIGRATIONS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/migrations/down", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: rollbackLastMigration(pool) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rollback migration";
      return errorResponse("ROLLBACK_MIGRATION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}