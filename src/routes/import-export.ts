import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { importData, exportData } from "../admin/import-export";
import { jsonResponse, errorResponse } from "../server";

export function registerImportExportRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/admin/:database/collections/:collection/import", async (req, params) => {
    try {
      const { data, format, autoCreate, dryRun, hasHeader } = await req.json();
      if (!data || typeof data !== "string") return errorResponse("VALIDATION", "Field 'data' is required.", 400);
      if (format !== undefined && format !== "csv" && format !== "json") return errorResponse("VALIDATION", "Field 'format' must be 'csv' or 'json'.", 400);
      const pool = manager.get(params.database);
      const result = importData(pool, params.collection, data, { format, autoCreate, dryRun, hasHeader });
      const status = dryRun ? 200 : (result.imported > 0 || result.collection ? 201 : 200);
      return jsonResponse({ data: result }, status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import data";
      return errorResponse("IMPORT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/admin/:database/collections/:collection/export", (req, params) => {
    try {
      const url = new URL(req.url);
      const format = (url.searchParams.get("format") || "json") as "csv" | "json";
      if (format !== "csv" && format !== "json") return errorResponse("VALIDATION", "Query parameter 'format' must be 'csv' or 'json'.", 400);
      const sort = url.searchParams.get("sort") || undefined;
      const direction = (url.searchParams.get("direction") || undefined) as "asc" | "desc" | undefined;
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      const fieldsParam = url.searchParams.get("fields");
      const fields = fieldsParam ? fieldsParam.split(",").map(s => s.trim()) : undefined;
      const pool = manager.get(params.database);
      const result = exportData(pool, params.collection, { format, sort, direction, limit: limit ? parseInt(limit, 10) : undefined, offset: offset ? parseInt(offset, 10) : undefined, fields });
      if (format === "csv") {
        return new Response(result.data, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${params.collection}.csv"` } });
      }
      return jsonResponse({ data: JSON.parse(result.data) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export data";
      return errorResponse("EXPORT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}