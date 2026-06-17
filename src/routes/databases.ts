import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import type { ApiResponse } from "../server";
import { jsonResponse, errorResponse, safeErrorResponse, auditFromRequest, logAuditEvent } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

export function registerDatabaseRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.get("/api/admin/databases", async (req) => {
    // Databases are global; authenticate against the system/meta database path.
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const databases = manager.listDatabases();
      return jsonResponse({ data: databases });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list databases";
      return errorResponse("DATABASES_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/databases", async (req) => {
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { name } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      const result = manager.createDatabase(name);
      logAuditEvent(auditFromRequest(req, {
        type: "database.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: name,
        action: "create",
        target: name,
        success: true,
      }), manager.getMetaPool());
      return jsonResponse({ data: result }, 201);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "database.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        action: "create",
        success: false,
        error: err instanceof Error ? err.message : "Failed to create database",
      }), manager.getMetaPool());
      return safeErrorResponse(err);
    }
  });

  router.delete("/api/admin/databases/:database", async (req, params) => {
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      manager.deleteDatabase(params.database);
      logAuditEvent(auditFromRequest(req, {
        type: "database.delete",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "delete",
        target: params.database,
        success: true,
      }), manager.getMetaPool());
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "database.delete",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "delete",
        success: false,
        error: err instanceof Error ? err.message : "Failed to delete database",
      }), manager.getMetaPool());
      return safeErrorResponse(err);
    }
  });
}
