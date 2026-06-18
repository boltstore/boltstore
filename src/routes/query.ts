import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { executeQuery, type QueryParams } from "../query";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { applyRLS, toRLSContext } from "../rls";

export function registerQueryRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/:database/query", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const { collection, filter, sort, fields, limit, offset, search, aggregate, groupBy, having } = await req.json();
    if (!collection || typeof collection !== "string") return errorResponse("VALIDATION", "Field 'collection' is required.", 400);
    const queryParams: QueryParams = {};
    if (filter) queryParams.filter = filter;
    if (sort) queryParams.sort = Array.isArray(sort) ? sort : [sort];
    if (fields) queryParams.fields = fields;
    if (limit !== undefined) queryParams.limit = limit;
    if (offset !== undefined) queryParams.offset = offset;
    if (search) queryParams.search = search;
    if (aggregate) queryParams.aggregate = aggregate;
    if (groupBy) queryParams.groupBy = groupBy;
    if (having) queryParams.having = having;
    const pool = manager.get(params.database);

    const rlsCtx = toRLSContext(auth);
    const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;

    const result = executeQuery(pool.read(), collection, queryParams, undefined, undefined, rls);
    return jsonResponse({ data: result.data, meta: result.meta });
  });
}
