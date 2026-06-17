import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createBackup, listBackups, restoreBackup } from "../admin/backup";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

export function registerBackupRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/admin/:database/backup", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const body = await req.json().catch(() => ({}));
      const { label } = body;
      const pool = manager.get(params.database);
      const dataDir = manager.getDataDir();
      const result = createBackup(pool, params.database, dataDir, { label });
      logAuditEvent(auditFromRequest(req, {
        type: "backup.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "create",
        target: result.id,
        success: true,
        details: { label },
      }));
      return jsonResponse({ data: result }, 201);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "backup.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "create",
        success: false,
        error: err instanceof Error ? err.message : "Failed to create backup",
      }));
      return safeErrorResponse(err);
    }
  });

  router.get("/api/admin/:database/backups", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const pool = manager.get(params.database);
    return jsonResponse({ data: listBackups(pool) });
  });

  router.post("/api/admin/:database/restore/:backupId", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const result = restoreBackup(manager, params.database, params.backupId);
      logAuditEvent(auditFromRequest(req, {
        type: "backup.restore",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "restore",
        target: params.backupId,
        success: true,
      }));
      return jsonResponse({ data: result, meta: { warning: "All active connections to this database have been dropped." } });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "backup.restore",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "restore",
        target: params.backupId,
        success: false,
        error: err instanceof Error ? err.message : "Failed to restore backup",
      }));
      return safeErrorResponse(err);
    }
  });
}
