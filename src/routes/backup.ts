import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createBackup, listBackups, restoreBackup } from "../admin/backup";
import { jsonResponse, errorResponse } from "../server";

export function registerBackupRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/admin/:database/backup", async (req, params) => {
    try {
      const body = await req.json().catch(() => ({}));
      const { label } = body;
      const pool = manager.get(params.database);
      const dataDir = manager.getDataDir();
      return jsonResponse({ data: createBackup(pool, params.database, dataDir, { label }) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create backup";
      return errorResponse("BACKUP_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/admin/:database/backups", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: listBackups(pool) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list backups";
      return errorResponse("LIST_BACKUPS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/restore/:backupId", (_req, params) => {
    try {
      const result = restoreBackup(manager, params.database, params.backupId);
      return jsonResponse({ data: result, meta: { warning: "All active connections to this database have been dropped." } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to restore backup";
      return errorResponse("RESTORE_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}