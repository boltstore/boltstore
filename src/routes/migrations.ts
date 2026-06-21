import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { listMigrations, applyMigrations, rollbackLastMigration } from "../migrations";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";
import { resolveSafePath } from "@boltstore/utils";

export function registerMigrationRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.get("/api/admin/:database/migrations", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const pool = manager.get(params.database);
    return jsonResponse({ data: listMigrations(pool) });
  });

  router.post("/api/admin/:database/migrations/up", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { migrationDir } = await req.json();
      if (!migrationDir || typeof migrationDir !== "string") return errorResponse("VALIDATION", "Field 'migrationDir' is required.", 400);
      if (migrationDir.includes("..")) return errorResponse("VALIDATION", "Path traversal detected in migrationDir.", 400);
      const pool = manager.get(params.database);
      const result = await applyMigrations(pool, migrationDir);
      logAuditEvent(auditFromRequest(req, {
        type: "migration.up",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "up",
        success: true,
        details: { migrationDir, applied: result.applied },
      }));
      return jsonResponse({ data: result });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "migration.up",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "up",
        success: false,
        error: err instanceof Error ? err.message : "Failed to apply migrations",
      }));
      return safeErrorResponse(err);
    }
  });

  router.post("/api/admin/:database/migrations/down", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const pool = manager.get(params.database);
      const result = rollbackLastMigration(pool);
      logAuditEvent(auditFromRequest(req, {
        type: "migration.down",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "down",
        success: true,
        details: { rolledBack: result.rolledBack },
      }));
      return jsonResponse({ data: result });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "migration.down",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "down",
        success: false,
        error: err instanceof Error ? err.message : "Failed to rollback migration",
      }));
      return safeErrorResponse(err);
    }
  });
}