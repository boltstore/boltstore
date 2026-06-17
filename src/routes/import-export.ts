import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { importData, exportData } from "../admin/import-export";
import { jsonResponse, errorResponse, logAuditEvent, auditFromRequest, MAX_RESPONSE_SIZE } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";
import { buildListSql } from "../records";

export interface ImportExportOptions {
  maxImportRows?: number;
}

export function registerImportExportRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig,
  options: ImportExportOptions = {}
): void {
  const maxImportRows = options.maxImportRows ?? 100000;

  router.post("/api/admin/:database/collections/:collection/import", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { data, format, autoCreate, dryRun, hasHeader } = await req.json();
      if (!data || typeof data !== "string") return errorResponse("VALIDATION", "Field 'data' is required.", 400);
      if (format !== undefined && format !== "csv" && format !== "json") return errorResponse("VALIDATION", "Field 'format' must be 'csv' or 'json'.", 400);
      // Streaming/chunked validation: reject payloads that exceed the configured row cap.
      const estimatedRows = format === "csv" ? data.split(/\r?\n/).length : (data.startsWith("[") ? 0 : data.split(/\r?\n/).filter(Boolean).length);
      if (estimatedRows > maxImportRows) {
        return errorResponse("IMPORT_TOO_LARGE", `Import data exceeds maximum of ${maxImportRows} rows.`, 413);
      }
      const pool = manager.get(params.database);
      const result = importData(pool, params.collection, data, { format, autoCreate, dryRun, hasHeader, maxRows: maxImportRows });
      logAuditEvent(auditFromRequest(req, {
        type: "import",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: dryRun ? "dry_run" : "import",
        success: true,
        details: { imported: result.imported, autoCreate, format },
      }));
      const status = dryRun ? 200 : (result.imported > 0 || result.collection ? 201 : 200);
      return jsonResponse({ data: result }, status);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "import",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "import",
        success: false,
        error: err instanceof Error ? err.message : "Failed to import data",
      }));
      const message = err instanceof Error ? err.message : "Failed to import data";
      return errorResponse("IMPORT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/admin/:database/collections/:collection/export/stream", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    logAuditEvent(auditFromRequest(req, {
      type: "export",
      principalId: auth.principalId,
      principalType: auth.isApiKey ? "api_key" : "user",
      database: params.database,
      collection: params.collection,
      action: "export_stream",
      success: true,
      details: { format: "ndjson" },
    }));

    const url = new URL(req.url);
    const sort = url.searchParams.get("sort") || "created_at";
    const direction = (url.searchParams.get("direction") || "desc") as "asc" | "desc";
    const pool = manager.get(params.database);

    const { sql, params: queryParams } = buildListSql(params.collection, { sort, direction });
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for (const row of pool.readQuery(sql, queryParams)) {
            const line = JSON.stringify(row) + "\n";
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="${params.collection}.ndjson"`,
      },
    });
  });

  router.get("/api/admin/:database/collections/:collection/export", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

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
        logAuditEvent(auditFromRequest(req, {
          type: "export",
          principalId: auth.principalId,
          principalType: auth.isApiKey ? "api_key" : "user",
          database: params.database,
          collection: params.collection,
          action: "export",
          success: true,
          details: { format, limit, offset },
        }));
        return new Response(result.data, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${params.collection}.csv"` } });
      }
      const responseData = { data: JSON.parse(result.data) };
      if (Buffer.byteLength(JSON.stringify(responseData), "utf8") > MAX_RESPONSE_SIZE) {
        logAuditEvent(auditFromRequest(req, {
          type: "export",
          principalId: auth.principalId,
          principalType: auth.isApiKey ? "api_key" : "user",
          database: params.database,
          collection: params.collection,
          action: "export",
          success: false,
          error: "Response exceeds maximum size",
        }));
        return errorResponse("RESPONSE_TOO_LARGE", `Export result exceeds ${MAX_RESPONSE_SIZE} bytes. Use smaller limit/offset or stream export.`, 413);
      }
      logAuditEvent(auditFromRequest(req, {
        type: "export",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "export",
        success: true,
        details: { format, limit, offset },
      }));
      return jsonResponse(responseData);
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "export",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        collection: params.collection,
        action: "export",
        success: false,
        error: err instanceof Error ? err.message : "Failed to export data",
      }));
      const message = err instanceof Error ? err.message : "Failed to export data";
      return errorResponse("EXPORT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}
