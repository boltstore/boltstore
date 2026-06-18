/**
 * API Key management routes for Boltstore — admin only.
 *
 * All endpoints live under `/api/admin/:database/api-keys`.
 *
 * @module boltstore/routes/api-keys
 */

import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import {
  createApiKey,
  listApiKeys,
  getApiKey,
  revokeApiKey,
} from "../admin/api-keys";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

export function registerApiKeyRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  // POST /api/admin/:database/api-keys — create a new API key
  // Authenticate against _system because API keys are system-level credentials.
  router.post("/api/admin/:database/api-keys", async (req, params) => {
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const metaPool = manager.getMetaPool();
      const body = await req.json();
      const { name, permissions } = body || {};

      if (!name || typeof name !== "string") {
        return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      }

      const apiKey = await createApiKey(metaPool, name, permissions || {});
      logAuditEvent(auditFromRequest(req, {
        type: "api_key.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "create",
        target: apiKey.id,
        success: true,
        details: { name, permissions: permissions || {} },
      }));
      return jsonResponse({ data: apiKey }, 201);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "api_key.create",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "create",
        success: false,
        error: err instanceof Error ? err.message : "Failed to create API key",
      }));
      return safeErrorResponse(err);
    }
  });

  // GET /api/admin/:database/api-keys — list all API keys (no secrets)
  router.get("/api/admin/:database/api-keys", async (req, params) => {
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const metaPool = manager.getMetaPool();
    const keys = listApiKeys(metaPool);
    return jsonResponse({ data: keys });
  });

  // GET /api/admin/:database/api-keys/:id — get a single API key
  router.get("/api/admin/:database/api-keys/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    const metaPool = manager.getMetaPool();
    const key = getApiKey(metaPool, params.id);
    return jsonResponse({ data: key });
  });

  // DELETE /api/admin/:database/api-keys/:id — revoke an API key
  router.delete("/api/admin/:database/api-keys/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const metaPool = manager.getMetaPool();
      revokeApiKey(metaPool, params.id);
      logAuditEvent(auditFromRequest(req, {
        type: "api_key.revoke",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "revoke",
        target: params.id,
        success: true,
      }));
      return jsonResponse({ data: { revoked: true, id: params.id } });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "api_key.revoke",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "revoke",
        target: params.id,
        success: false,
        error: err instanceof Error ? err.message : "Failed to revoke API key",
      }));
      return safeErrorResponse(err);
    }
  });
}