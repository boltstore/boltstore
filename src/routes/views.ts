import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createView, listViews, getView, queryView, dropView } from "../admin/views";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

export function registerViewRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/admin/:database/views", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { name, sql } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
      const pool = manager.get(params.database);
      const result = createView(pool, name, sql);
      logAuditEvent(auditFromRequest(req, {
        type: "view.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "create",
        target: name,
        success: true,
        details: { sql: sql.slice(0, 200) },
      }));
      return jsonResponse({ data: result }, 201);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "view.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "create",
        success: false,
        error: err instanceof Error ? err.message : "Failed to create view",
      }));
      return safeErrorResponse(err);
    }
  });

  router.get("/api/admin/:database/views", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const pool = manager.get(params.database);
    return jsonResponse({ data: listViews(pool) });
  });

  router.get("/api/admin/:database/views/:name", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

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
  });

  router.delete("/api/admin/:database/views/:name", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const pool = manager.get(params.database);
      dropView(pool, params.name);
      logAuditEvent(auditFromRequest(req, {
        type: "view.drop",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "drop",
        target: params.name,
        success: true,
      }));
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "view.drop",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "drop",
        success: false,
        error: err instanceof Error ? err.message : "Failed to drop view",
      }));
      return safeErrorResponse(err);
    }
  });
}