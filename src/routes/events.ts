import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { listChanges } from "../ws/changes";
import { createSseResponse } from "../ws/sse";

export function registerEventRoutes(router: Router, manager: DatabaseManager, authConfig: AuthConfig): void {
  router.get("/api/:database/events/changes", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const pool = manager.get(params.database);
    const changes = listChanges(pool, {
      collection: url.searchParams.get("collection") || undefined,
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
