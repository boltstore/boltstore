import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createIndex, listIndexes, dropIndex, type IndexDefinition } from "../indexes";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

export function registerIndexRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/admin/:database/collections/:collection/indexes", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { name, columns, unique } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      const result = createIndex(pool, params.collection, name, { columns, unique } as IndexDefinition);
      logAuditEvent(auditFromRequest(req, {
        type: "index.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "create",
        target: name,
        success: true,
        details: { columns, unique },
      }));
      return jsonResponse({ data: result }, 201);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "index.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "create",
        success: false,
        error: err instanceof Error ? err.message : "Failed to create index",
      }));
      return safeErrorResponse(err);
    }
  });

  router.get("/api/admin/:database/collections/:collection/indexes", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const pool = manager.get(params.database);
    return jsonResponse({ data: listIndexes(pool, params.collection) });
  });

  router.delete("/api/admin/:database/collections/:collection/indexes/:name", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const pool = manager.get(params.database);
      dropIndex(pool, params.collection, params.name);
      logAuditEvent(auditFromRequest(req, {
        type: "index.drop",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "drop",
        target: params.name,
        success: true,
      }));
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "index.drop",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "drop",
        success: false,
        error: err instanceof Error ? err.message : "Failed to drop index",
      }));
      return safeErrorResponse(err);
    }
  });
}