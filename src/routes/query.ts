import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { queryFromParams } from "../query/from-params";
import type { RLSFilter } from "../query/sql-generator";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { applyRLS, toRLSContext } from "../rls";
import { apiKeyAllows } from "../admin/api-keys";

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
}

function checkRLS(
  pool: import("../db/pool").DatabasePool,
  collection: string,
  rlsCtx: import("../rls").RLSContext | null,
): import("../rls").RLSResult | null {
  if (!rlsCtx) return null;
  return applyRLS(pool, collection, "read", rlsCtx);
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

    // Enforce API-key collection scopes (primary + joined collections)
    if (auth.isApiKey) {
      const checkScope = (col: string): Response | null => {
        if (isSystemCollection(col) && auth.apiKey?.permissions.role !== "admin") {
          return errorResponse("FORBIDDEN", "API key cannot query system collections.", 403);
        }
        if (!apiKeyAllows(auth.apiKey!, params.database, "read", col)) {
          return errorResponse("FORBIDDEN", `API key lacks permission for collection "${col}".`, 403);
        }
        return null;
      };
      const scopeErr = checkScope(collection);
      if (scopeErr) return scopeErr;

      // Check joined collections from the request body
      const joins = body.joins;
      if (joins && Array.isArray(joins)) {
        for (const j of joins) {
          if (j.target && j.target !== collection) {
            const err = checkScope(j.target);
            if (err) return err;
          }
        }
      }
    }

    const pool = manager.get(params.database);
    const rlsCtx = toRLSContext(auth);
    const rls = checkRLS(pool, collection, rlsCtx);

    try {
      const db = pool.read();
      const qb = queryFromParams(body, db);
      qb.applyRLS(rls);

      // RLS for joined collections — each joined table gets wrapped in a subquery
      const joinRLSFilters = new Map<string, RLSFilter>();
      const seen = new Set<string>([collection]);
      for (const join of qb.state.joins) {
        if (!seen.has(join.target)) {
          seen.add(join.target);
          const joinRls = checkRLS(pool, join.target, rlsCtx);
          if (joinRls) {
            joinRLSFilters.set(join.target, {
              whereClause: joinRls.whereClause,
              params: joinRls.params as unknown[],
            });
          }
        }
      }
      qb.setRLSFilters(joinRLSFilters);

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
