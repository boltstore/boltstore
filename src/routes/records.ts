import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createRecord, listRecords, getRecord, updateRecord, deleteRecord, countRecords, distinctValues, batchRecords, buildPaginationMeta } from "../records";
import { expandRecords, cascadeDelete } from "../relations";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { apiKeyAllows, operationForMethod } from "../admin/api-keys";
import { notifyRecordChange } from "../ws/cdc";
import { generateSecureId } from "@boltstore/utils";

function principalId(auth: Awaited<ReturnType<typeof authenticateRequest>>): string | undefined {
  return auth instanceof Response ? undefined : auth.principalId;
}

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
}

function requireApiKeyCollectionPermission(auth: Awaited<ReturnType<typeof authenticateRequest>>, database: string, collection: string, method: string) {
  if (auth instanceof Response) return auth;
  // System collections (_users, _tokens, etc.) are only accessible by admins
  if (isSystemCollection(collection)) {
    if (!auth.isAdmin) {
      return new Response(
        JSON.stringify({ error: { code: "FORBIDDEN", message: "System collections are only accessible by admins." } }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    return null;
  }
  if (auth.isApiKey) {
    const op = operationForMethod(method);
    if (!apiKeyAllows(auth.apiKey!, database, op, collection)) {
      return new Response(
        JSON.stringify({ error: { code: "FORBIDDEN", message: "API key lacks permission for this collection/operation." } }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  return null;
}

const SCALAR_TYPES = ["string", "number", "boolean"];

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || SCALAR_TYPES.includes(typeof v) || (Array.isArray(v) && v.every(e => SCALAR_TYPES.includes(typeof e)));
}

function validateFilterValues(filter: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(filter)) {
    if (!isScalar(value)) {
      throw Object.assign(new Error(`Filter value for "${key}" must be a scalar or array of scalars.`), { status: 400 });
    }
  }
}

export function registerRecordRoutes(router: Router, manager: DatabaseManager, authConfig: AuthConfig): void {
  router.post("/api/:database/collections/:collection/records", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
    const pool = manager.get(params.database);
    const record = createRecord(pool, params.collection, body, auth);
    notifyRecordChange("create", params.database, params.collection, record, undefined, pool, principalId(auth));
    return jsonResponse({ data: record }, 201);
  });

  router.get("/api/:database/collections/:collection/records", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const url = new URL(req.url);
    const pool = manager.get(params.database);
    const options: { filter?: Record<string,unknown>; sort?: string; direction?: "asc"|"desc"; limit?: number; offset?: number; page?: number; perPage?: number; cursor?: string; fields?: string[]; search?: string; searchFields?: string[] } = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (key === "sort") options.sort = value;
      else if (key === "direction") options.direction = value as "asc"|"desc";
      else if (key === "limit") options.limit = parseInt(value, 10);
      else if (key === "offset") options.offset = parseInt(value, 10);
      else if (key === "page") options.page = parseInt(value, 10);
      else if (key === "per_page") options.perPage = Math.min(parseInt(value, 10), 1000);
      else if (key === "cursor") options.cursor = value;
      else if (key === "fields") options.fields = value.split(",").map(s => s.trim()).filter(Boolean);
      else if (key === "expand" || key === "cascade") { /* consumed separately, skip */ }
      else if (key === "search") options.search = value;
      else if (key === "search_fields") options.searchFields = value.split(",").map(s => s.trim()).filter(Boolean);
      else { if (!options.filter) options.filter = {}; options.filter[key] = value; }
    }
    if (options.filter) validateFilterValues(options.filter);
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
  });

  router.get("/api/:database/collections/:collection/records/count", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const url = new URL(req.url);
    const pool = manager.get(params.database);
    const filter: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (value === null || value === undefined) continue;
      filter[key] = value;
    }
    if (Object.keys(filter).length > 0) validateFilterValues(filter);
    const count = countRecords(pool, params.collection, Object.keys(filter).length > 0 ? filter : undefined, auth);
    return jsonResponse({ data: { count } });
  });

  router.get("/api/:database/collections/:collection/records/distinct", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const url = new URL(req.url);
    const field = url.searchParams.get("field");
    if (!field) return errorResponse("VALIDATION", "Query parameter 'field' is required.", 400);
    const pool = manager.get(params.database);
    return jsonResponse({ data: { field, values: distinctValues(pool, params.collection, field, auth) } });
  });

  router.get("/api/:database/collections/:collection/records/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const pool = manager.get(params.database);
    return jsonResponse({ data: getRecord(pool, params.collection, params.id, auth) });
  });

  router.patch("/api/:database/collections/:collection/records/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
    const pool = manager.get(params.database);
    const previous = getRecord(pool, params.collection, params.id, auth);
    const record = updateRecord(pool, params.collection, params.id, body, auth);
    notifyRecordChange("update", params.database, params.collection, record, previous, pool, principalId(auth));
    return jsonResponse({ data: record });
  });

  router.delete("/api/:database/collections/:collection/records/:id", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const url = new URL(req.url);
    const shouldCascade = url.searchParams.get("cascade") === "true";
    const pool = manager.get(params.database);
    const record = getRecord(pool, params.collection, params.id, auth);
    if (shouldCascade) {
      const cascadeResult = cascadeDelete(pool, params.collection, params.id, auth);
      deleteRecord(pool, params.collection, params.id, auth);
      notifyRecordChange("delete", params.database, params.collection, record, undefined, pool, principalId(auth));
      return jsonResponse({ data: { deleted: true, cascade: cascadeResult.deleted, cascaded: true } });
    }
    deleteRecord(pool, params.collection, params.id, auth);
    notifyRecordChange("delete", params.database, params.collection, record, undefined, pool, principalId(auth));
    return jsonResponse({ data: { deleted: true } });
  });

  router.post("/api/:database/collections/:collection/records/batch", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const perm = requireApiKeyCollectionPermission(auth, params.database, params.collection, req.method);
    if (perm instanceof Response) return perm;

    const body = await req.json();
    if (!Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be an array of operations.", 400);
    const pool = manager.get(params.database);

    // Pre-fetch full records for delete operations so notifications carry complete data
    const deleteRecords: Map<string, Record<string, unknown>> = new Map();
    for (const op of body) {
      if (op.action === "delete" && op.id) {
        try {
          deleteRecords.set(op.id, getRecord(pool, params.collection, op.id, auth));
        } catch {
          // Record does not exist; batchRecords will handle the error
        }
      }
    }

    const result = batchRecords(pool, params.collection, body, auth);

    const timestamp = new Date().toISOString();
    for (const op of body) {
      if (op.action === "delete" && op.id) {
        const deleted = deleteRecords.get(op.id) || { id: op.id };
        notifyRecordChange("delete", params.database, params.collection, deleted, undefined, pool, principalId(auth));
      } else if (op.action === "create") {
        // Emit individual create events with estimated record data.
        // The batch function generates IDs internally, so we emit the
        // data-as-submitted shape rather than a placeholder.
        const createData = { ...(op.data || {}), id: generateSecureId("rec"), created_at: timestamp, updated_at: timestamp };
        notifyRecordChange("create", params.database, params.collection, createData, undefined, pool, principalId(auth));
      }
    }

    return jsonResponse({ data: result });
  });
}