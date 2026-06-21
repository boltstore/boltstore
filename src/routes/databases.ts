import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity } from "./activity";

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
    logActivity(manager, { action: "database.create", database_name: body.name, ip: req.headers.get("x-forwarded-for") || undefined });
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
    const body = await req.json() as { name?: string };
    if (!body.name || !VALID_NAME.test(body.name)) {
      return errorResponse("VALIDATION", "New name must match ^[a-z0-9][a-z0-9_-]*$", 400);
    }
    const oldName = params.name;
    const metaPool = manager.getMetaPool();
    const row = metaPool.read().query("SELECT file_path FROM _databases WHERE name = ?").get(oldName) as { file_path: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);

    const newPath = row.file_path.replace(oldName, body.name);
    const { renameSync } = require("node:fs");
    try {
      renameSync(row.file_path, newPath);
    } catch {
      return errorResponse("ERROR", "Failed to rename database file.", 500);
    }

    // Update child table references before renaming
    metaPool.write().run("UPDATE _api_keys SET database_name = ? WHERE database_name = ?", [body.name, oldName]);
    metaPool.write().run("UPDATE _databases SET name = ?, file_path = ? WHERE name = ?", [body.name, newPath, oldName]);
    logActivity(manager, { action: "database.rename", database_name: oldName, details: { from: oldName, to: body.name }, ip: req.headers.get("x-forwarded-for") || undefined });
    return jsonResponse({ data: { name: body.name } });
  });

  router.delete("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    manager.deleteDatabase(params.name);
    logActivity(manager, { action: "database.delete", database_name: params.name, ip: req.headers.get("x-forwarded-for") || undefined });
    return jsonResponse({ data: { deleted: true } });
  });
}
