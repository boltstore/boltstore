import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";

const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function registerDatabaseRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/databases", async (req) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const databases = manager.listDatabases();
    return jsonResponse({ data: databases });
  });

  router.post("/api/databases", async (req) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await req.json() as { name?: string };
    if (!body.name || !VALID_NAME.test(body.name)) {
      return errorResponse("VALIDATION", "Database name must match ^[a-z0-9][a-z0-9_-]*$", 400);
    }
    const info = manager.createDatabase(body.name);
    return jsonResponse({ data: info }, 201);
  });

  router.get("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    try {
      const pool = manager.get(params.name);
      const db = pool.read();
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%' ORDER BY name").all() as { name: string }[];
      const info = manager.listDatabases().find(d => d.name === params.name);
      if (!info) return errorResponse("NOT_FOUND", "Database not found.", 404);
      return jsonResponse({ data: { ...info, tables: tables.map(t => t.name) } });
    } catch {
      return errorResponse("NOT_FOUND", "Database not found.", 404);
    }
  });

  router.patch("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    return errorResponse("NOT_IMPLEMENTED", "Database rename not yet implemented.", 501);
  });

  router.delete("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    manager.deleteDatabase(params.name);
    return jsonResponse({ data: { deleted: true } });
  });
}
