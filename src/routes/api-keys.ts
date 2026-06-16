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
import { jsonResponse, errorResponse } from "../server";

export function registerApiKeyRoutes(
  router: Router,
  manager: DatabaseManager
): void {
  // POST /api/admin/:database/api-keys — create a new API key
  router.post("/api/admin/:database/api-keys", async (_req, params) => {
    try {
      const pool = manager.get(params.database);
      const body = await _req.json();
      const { name, permissions } = body || {};

      if (!name || typeof name !== "string") {
        return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      }

      const apiKey = await createApiKey(pool, name, permissions || {});
      return jsonResponse({ data: apiKey }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create API key";
      return errorResponse("CREATE_API_KEY_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // GET /api/admin/:database/api-keys — list all API keys (no secrets)
  router.get("/api/admin/:database/api-keys", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      const keys = listApiKeys(pool);
      return jsonResponse({ data: keys });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list API keys";
      return errorResponse("LIST_API_KEYS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // GET /api/admin/:database/api-keys/:id — get a single API key
  router.get("/api/admin/:database/api-keys/:id", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      const key = getApiKey(pool, params.id);
      return jsonResponse({ data: key });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get API key";
      return errorResponse("GET_API_KEY_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // DELETE /api/admin/:database/api-keys/:id — revoke an API key
  router.delete("/api/admin/:database/api-keys/:id", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      revokeApiKey(pool, params.id);
      return jsonResponse({ data: { revoked: true, id: params.id } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to revoke API key";
      return errorResponse("REVOKE_API_KEY_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}