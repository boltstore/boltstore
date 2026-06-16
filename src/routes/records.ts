import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createRecord, listRecords, getRecord, updateRecord, deleteRecord, countRecords, distinctValues, batchRecords } from "../records";
import { expandRecords, cascadeDelete } from "../relations";
import { jsonResponse, errorResponse } from "../server";

export function registerRecordRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/:database/collections/:collection/records", async (req, params) => {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: createRecord(pool, params.collection, body) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create record";
      return errorResponse("CREATE_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records", (req, params) => {
    try {
      const url = new URL(req.url);
      const pool = manager.get(params.database);
      const options: { filter?: Record<string,unknown>; sort?: string; direction?: "asc"|"desc"; limit?: number; offset?: number } = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (key === "sort") options.sort = value;
        else if (key === "direction") options.direction = value as "asc"|"desc";
        else if (key === "limit") options.limit = parseInt(value, 10);
        else if (key === "offset") options.offset = parseInt(value, 10);
        else { if (!options.filter) options.filter = {}; options.filter[key] = value; }
      }
      const expand = url.searchParams.get("expand");
      const expandFields = expand ? expand.split(",").map(s => s.trim()) : [];
      let results = listRecords(pool, params.collection, options);
      if (expandFields.length > 0) results = expandRecords(pool, params.collection, results, expandFields);
      return jsonResponse({ data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list records";
      return errorResponse("LIST_RECORDS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records/count", (req, params) => {
    try {
      const url = new URL(req.url);
      const pool = manager.get(params.database);
      const filter: Record<string, unknown> = {};
      for (const [key, value] of url.searchParams.entries()) filter[key] = value;
      const count = countRecords(pool, params.collection, Object.keys(filter).length > 0 ? filter : undefined);
      return jsonResponse({ data: { count } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to count records";
      return errorResponse("COUNT_RECORDS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records/distinct", (req, params) => {
    try {
      const url = new URL(req.url);
      const field = url.searchParams.get("field");
      if (!field) return errorResponse("VALIDATION", "Query parameter 'field' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: { field, values: distinctValues(pool, params.collection, field) } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get distinct values";
      return errorResponse("DISTINCT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection/records/:id", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: getRecord(pool, params.collection, params.id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get record";
      return errorResponse("GET_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.patch("/api/:database/collections/:collection/records/:id", async (req, params) => {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: updateRecord(pool, params.collection, params.id, body) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update record";
      return errorResponse("UPDATE_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.delete("/api/:database/collections/:collection/records/:id", (req, params) => {
    try {
      const url = new URL(req.url);
      const shouldCascade = url.searchParams.get("cascade") === "true";
      const pool = manager.get(params.database);
      if (shouldCascade) {
        const cascadeResult = cascadeDelete(pool, params.collection, params.id);
        deleteRecord(pool, params.collection, params.id);
        return jsonResponse({ data: { deleted: true, cascade: cascadeResult.deleted, cascaded: true } });
      }
      deleteRecord(pool, params.collection, params.id);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete record";
      return errorResponse("DELETE_RECORD_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/:database/collections/:collection/records/batch", async (req, params) => {
    try {
      const body = await req.json();
      if (!Array.isArray(body)) return errorResponse("VALIDATION", "Request body must be an array of operations.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: batchRecords(pool, params.collection, body) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process batch operations";
      return errorResponse("BATCH_RECORDS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}