import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createRecord, listRecords, getRecord, updateRecord, deleteRecord, countRecords, distinctValues, batchRecords, buildPaginationMeta } from "../records";
import { expandRecords, cascadeDelete } from "../relations";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { apiKeyAllows, operationForMethod } from "../admin/api-keys";

function requireApiKeyCollectionPermission(auth: Awaited<ReturnType<typeof authenticateRequest>>, collection: string, method: string) {
  if (auth instanceof Response) return auth;
  if (auth.isApiKey) {
    const op = operationForMethod(method);
    if (!apiKeyAllows(auth.apiKey!, op, collection)) {
      return new Response(
        JSON.stringify({ error: { code: "FORBIDDEN", message: "API key lacks permission for this collection/operation." } }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  return null;
}

export function registerRecordRoutes(router: Router, manager: DatabaseManager, authConfig: AuthConfig): void {
  router.post("/api/:database/collections/:collection/records", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: createRecord(pool, params.collection, body, auth) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create record";
      return errorResponse("CREATE_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const url = new URL(req.url);
      const pool = manager.get(params.database);
      const options: { filter?: Record<string,unknown>; sort?: string; direction?: "asc"|"desc"; limit?: number; offset?: number; page?: number; perPage?: number; cursor?: string; fields?: string[] } = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (key === "sort") options.sort = value;
        else if (key === "direction") options.direction = value as "asc"|"desc";
        else if (key === "limit") options.limit = parseInt(value, 10);
        else if (key === "offset") options.offset = parseInt(value, 10);
        else if (key === "page") options.page = parseInt(value, 10);
        else if (key === "per_page") options.perPage = parseInt(value, 10);
        else if (key === "cursor") options.cursor = value;
        else if (key === "fields") options.fields = value.split(",").map(s => s.trim()).filter(Boolean);
        else { if (!options.filter) options.filter = {}; options.filter[key] = value; }
      }
      const expand = url.searchParams.get("expand");
      const expandFields = expand ? expand.split(",").map(s => s.trim()) : [];
      const records = listRecords(pool, params.collection, options, auth);
      let results = records;
      if (expandFields.length > 0) results = expandRecords(pool, params.collection, results, expandFields);
      const lastRecord = results[results.length - 1];
      const meta = (options.page !== undefined && options.perPage !== undefined)
        ? buildPaginationMeta(pool, params.collection, { page: options.page, perPage: options.perPage, filter: options.filter, sort: options.sort }, auth, lastRecord)
        : {};
      if (options.cursor) {
        meta.next_cursor = lastRecord ? (lastRecord[options.sort || "created_at"] as string | undefined) : null;
      }
      return jsonResponse({ data: results, meta });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list records";
      return errorResponse("LIST_RECORDS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records/count", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const url = new URL(req.url);
      const pool = manager.get(params.database);
      const filter: Record<string, unknown> = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (value === null || value === undefined) continue;
        // Server record-list treats every unknown query param as a scalar filter.
        filter[key] = value;
      }
      const count = countRecords(pool, params.collection, Object.keys(filter).length > 0 ? filter : undefined, auth);
      return jsonResponse({ data: { count } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to count records";
      return errorResponse("COUNT_RECORDS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records/distinct", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const url = new URL(req.url);
      const field = url.searchParams.get("field");
      if (!field) return errorResponse("VALIDATION", "Query parameter 'field' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: { field, values: distinctValues(pool, params.collection, field, auth) } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get distinct values";
      return errorResponse("DISTINCT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: getRecord(pool, params.collection, params.id, auth) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get record";
      return errorResponse("GET_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.patch("/api/:database/collections/:collection/records/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: updateRecord(pool, params.collection, params.id, body, auth) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update record";
      return errorResponse("UPDATE_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.delete("/api/:database/collections/:collection/records/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const url = new URL(req.url);
      const shouldCascade = url.searchParams.get("cascade") === "true";
      const pool = manager.get(params.database);
      if (shouldCascade) {
        const cascadeResult = cascadeDelete(pool, params.collection, params.id, auth);
        deleteRecord(pool, params.collection, params.id, auth);
        return jsonResponse({ data: { deleted: true, cascade: cascadeResult.deleted, cascaded: true } });
      }
      deleteRecord(pool, params.collection, params.id, auth);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete record";
      return errorResponse("DELETE_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/:database/collections/:collection/records/batch", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.collection, req.method);
    if (perm instanceof Response) return perm;

    try {
      const body = await req.json();
      if (!Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be an array of operations.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: batchRecords(pool, params.collection, body, auth) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process batch operations";
      return errorResponse("BATCH_RECORDS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}