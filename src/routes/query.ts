import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";
import { checkReadOnly } from "../middleware/readonly";
import { recordAnalytics } from "./analytics";
import { logger } from "../logger";
import { toBindings } from "../db/cast";
import { resolve } from "node:path";

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA|REINDEX|ANALYZE)\b/i;
const ATTACH_PATH_PATTERN = /ATTACH\s+(?:DATABASE\s+)?['"]([^'"]+)['"]/gi;
const SQL_COMMENT_ORPHAN = /--[^\n]*|\/\*[\s\S]*?\*\//g;

function stripComments(sql: string): string {
  return sql.replace(SQL_COMMENT_ORPHAN, "").trim();
}

function isWriteStatement(sql: string): boolean {
  const cleaned = stripComments(sql);
  // Check each semicolon-separated statement — a query like "SELECT 1; INSERT INTO t VALUES (1)"
  // starts with SELECT but contains a write, which would fail on a read connection.
  const statements = cleaned.split(";").filter(s => s.trim().length > 0);
  return statements.some(stmt => WRITE_PATTERN.test(stmt.trim()));
}

export function registerQueryRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/databases/:db/query", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const start = performance.now();
    const body = await parseJsonBody<{ sql?: string; params?: unknown[] }>(req); if (body instanceof Response) return body;
    if (!body.sql || typeof body.sql !== "string") {
      return errorResponse("VALIDATION", "Field 'sql' is required.", 400);
    }

    const sql = body.sql;
    const isWrite = isWriteStatement(sql);

    if (isWrite) {
      const ro = checkReadOnly(manager, params.db);
      if (ro) return ro;
    }

    // Use comment-stripped SQL for ATTACH detection so SQL comments cannot bypass
    // the check. Non-admin users are blocked entirely from ATTACH because the
    // path validation regex has edge cases that are difficult to cover exhaustively.
    if (isWrite && /^\s*ATTACH\b/i.test(stripComments(sql))) {
      if (!auth.isAdmin) {
        return errorResponse("ATTACH_REJECTED", "ATTACH DATABASE requires admin privileges.", 403);
      }
      const cleanedSql = stripComments(sql);
      const attachPattern = /ATTACH\s+(?:DATABASE\s+)?['"]([^'"]+)['"]/gi;
      let match: RegExpExecArray | null;
      while ((match = attachPattern.exec(cleanedSql)) !== null) {
        const attachedPath = resolve(match[1].replace(/''/g, "'"));
        const dataDir = resolve(manager.getDataDir());
        if (!attachedPath.startsWith(dataDir + "/") && attachedPath !== dataDir) {
          return errorResponse("ATTACH_REJECTED", "ATTACH DATABASE path must be within the server data directory.", 403);
        }
      }
    }

    const pool = manager.get(params.db);
    const bindings = toBindings(Array.isArray(body.params) ? body.params : []);

    try {
      if (isWrite) {
        const result = pool.write().run(sql, bindings);
        recordAnalytics(manager, { database: params.db, operation: "update", durationMs: performance.now() - start, rowCount: result.changes, status: "ok", sqlText: sql });
        return jsonResponse({ data: null, meta: { changes: result.changes } });
      }
      const rows = pool.read().query(sql).all(...bindings);
      recordAnalytics(manager, { database: params.db, operation: "select", durationMs: performance.now() - start, rowCount: rows.length, status: "ok", sqlText: sql });
      return jsonResponse({ data: rows });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Query endpoint error", { database: params.db, error: msg });
      recordAnalytics(manager, { database: params.db, operation: isWrite ? "update" : "select", durationMs: performance.now() - start, rowCount: 0, status: "error", errorMessage: msg, sqlText: sql });
      return errorResponse("QUERY_ERROR", "Query execution failed. Check your SQL syntax or constraints.", 400);
    }
  });
}
