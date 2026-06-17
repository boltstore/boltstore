import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { executeReadQuery, executeWriteQuery, explainQuery, type QueryContext } from "../admin/query";
import { jsonResponse, errorResponse, auditFromRequest, logAuditEvent } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig, type AuthContext } from "../middleware/auth";
import { requestContext } from "../server";

function queryContext(req: Request, database: string, auth: AuthContext): QueryContext {
  const ctx = requestContext.get(req);
  return {
    database,
    principalId: auth.principalId,
    principalType: auth.isApiKey ? "api_key" : "user",
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  };
}

export function registerAdminQueryRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/admin/:database/query", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const { sql, params: queryParams } = await req.json();
    if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    const pool = manager.get(params.database);
    return jsonResponse({ data: executeReadQuery(pool, sql, Array.isArray(queryParams) ? queryParams : []) });
  });

  router.post("/api/admin/:database/query/write", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const { sql, params: queryParams } = await req.json();
    if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    const pool = manager.get(params.database);
    const ctx = queryContext(req, params.database, auth);
    return jsonResponse({ data: executeWriteQuery(pool, sql, Array.isArray(queryParams) ? queryParams : [], ctx) });
  });

  router.post("/api/admin/:database/query/explain", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const { sql, params: queryParams } = await req.json();
    if (!sql || typeof sql !== "string") return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    const pool = manager.get(params.database);
    return jsonResponse({ data: explainQuery(pool, sql, Array.isArray(queryParams) ? queryParams : []) });
  });
}
