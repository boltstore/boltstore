import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { queryFromParams } from "../query/from-params";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { applyRLS, toRLSContext } from "../rls";
import { apiKeyAllows } from "../admin/api-keys";

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
}

export function registerQueryRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/:database/query", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const collection = body.collection;
    if (!collection || typeof collection !== "string") return errorResponse("VALIDATION", "Field 'collection' is required.", 400);

    // Enforce API-key collection scopes
    if (auth.isApiKey) {
      if (isSystemCollection(collection)) {
        if (auth.apiKey?.permissions.role !== "admin") {
          return errorResponse("FORBIDDEN", "API key cannot query system collections.", 403);
        }
      }
      if (!apiKeyAllows(auth.apiKey!, params.database, "read", collection)) {
        return errorResponse("FORBIDDEN", "API key lacks permission for this collection.", 403);
      }
    }

    const pool = manager.get(params.database);
    const rlsCtx = toRLSContext(auth);
    const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;

    try {
      const db = pool.read();
      const qb = queryFromParams(body, db);
      qb.applyRLS(rls);

      // Check if pagination was requested via query params
      const url = new URL(req.url);
      const pageParam = url.searchParams.get("page");
      const perPageParam = url.searchParams.get("per_page");

      if (pageParam && perPageParam) {
        const page = parseInt(pageParam, 10);
        const perPage = parseInt(perPageParam, 10);
        const result = qb.paginate(page, perPage);
        return jsonResponse({ data: result.data, meta: result.meta });
      }

      const data = qb.get();
      return jsonResponse({ data, meta: {} });
    } catch (err: any) {
      if (err.message?.startsWith("CTE nesting depth")) {
        return errorResponse("VALIDATION", err.message, 400);
      }
      if (err.message?.startsWith("Filter nesting")) {
        return errorResponse("VALIDATION", err.message, 400);
      }
      if (err.message?.startsWith("Raw SQL strings in join")) {
        return errorResponse("VALIDATION", err.message, 400);
      }
      throw err;
    }
  });
}
