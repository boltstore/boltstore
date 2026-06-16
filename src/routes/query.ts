import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { executeQuery, type QueryParams } from "../query";
import { jsonResponse, errorResponse } from "../server";

export function registerQueryRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/:database/query", async (req, params) => {
    try {
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
      const result = executeQuery(pool.read(), collection, queryParams);
      return jsonResponse({ data: result.data, meta: result.meta });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to execute query";
      return errorResponse("QUERY_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}