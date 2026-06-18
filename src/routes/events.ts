import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { listChanges } from "../ws/changes";
import { createSseResponse } from "../ws/sse";
import { apiKeyAllows } from "../admin/api-keys";

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
}

export function registerEventRoutes(router: Router, manager: DatabaseManager, authConfig: AuthConfig): void {
  router.get("/api/:database/events/changes", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const collection = url.searchParams.get("collection") || undefined;

    // Enforce API-key collection scopes
    if (auth.isApiKey && collection) {
      if (isSystemCollection(collection)) {
        if (auth.apiKey?.permissions.role !== "admin") {
          return errorResponse("FORBIDDEN", "API key cannot access system collection changes.", 403);
        }
      }
      if (!apiKeyAllows(auth.apiKey!, params.database, "read", collection)) {
        return errorResponse("FORBIDDEN", "API key lacks permission for this collection.", 403);
      }
    }

    const pool = manager.get(params.database);
    const changes = listChanges(pool, {
      collection,
      since: url.searchParams.get("since") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "100", 10),
      offset: parseInt(url.searchParams.get("offset") || "0", 10),
    });
    return jsonResponse({ data: changes });
  });

  router.get("/api/:database/events/stream", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const { response, id } = createSseResponse(
      params.database,
      auth.principalId,
      auth.email,
      auth.isAdmin
    );
    return response;
  });
}
