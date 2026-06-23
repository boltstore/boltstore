import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";

const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function registerDatabaseRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/databases", async (req) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const databases = manager.listDatabases();
    return jsonResponse({ data: databases });
  });

  router.post("/api/databases", async (req) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await req.json() as { name?: string; group?: string };
    if (!body.name || !VALID_NAME.test(body.name)) {
      return errorResponse("VALIDATION", "Use only lowercase letters, numbers, hyphens, and underscores, starting with a letter or number.", 400);
    }
    const info = manager.createDatabase(body.name, body.group);
    logActivity(manager, { action: "database.create", admin_id: getAdminId(req, manager), database_name: body.name, details: body.group ? { group: body.group } : undefined, ip: getClientIp(req) });
    return jsonResponse({ data: info }, 201);
  });

  router.get("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    try {
      const pool = manager.get(params.name);
      const db = pool.read();
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[];
      const info = manager.listDatabases().find(d => d.name === params.name);
      if (!info) return errorResponse("NOT_FOUND", "Database not found.", 404);
      return jsonResponse({ data: { ...info, tables: tables.map(t => t.name) } });
    } catch {
      return errorResponse("NOT_FOUND", "Database not found.", 404);
    }
  });

  router.patch("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await req.json() as { name?: string };
    if (!body.name || !VALID_NAME.test(body.name)) {
      return errorResponse("VALIDATION", "Use only lowercase letters, numbers, hyphens, and underscores, starting with a letter or number.", 400);
    }
    const oldName = params.name;

    // Move the database file using VACUUM INTO instead of filesystem rename
    // to avoid file lock and foreign key constraint issues
    const metaPool = manager.getMetaPool();
    const row = metaPool.read().query("SELECT file_path FROM _databases WHERE name = ?").get(oldName) as { file_path: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);

    const newPath = row.file_path.replace(oldName, body.name);
    const pool = manager.get(oldName);

    try {
      pool.write().run(`VACUUM INTO '${newPath.replace(/'/g, "''")}'`);
    } catch (err: any) {
      return errorResponse("ERROR", err?.message || "Failed to copy database.", 500);
    }

    // Use a transaction with deferred foreign keys so both updates succeed atomically
    const metaWrite = metaPool.write();
    metaWrite.run("BEGIN");
    metaWrite.run("PRAGMA defer_foreign_keys = ON");
    metaWrite.run("UPDATE _databases SET name = ?, file_path = ? WHERE name = ?", [body.name, newPath, oldName]);
    metaWrite.run("UPDATE _api_keys SET database_name = ? WHERE database_name = ?", [body.name, oldName]);
    metaWrite.run("COMMIT");

    // Close old pool, remove old file
    manager.closePool(oldName);
    try { require("node:fs").rmSync(row.file_path); } catch {}

    logActivity(manager, { action: "database.rename", admin_id: getAdminId(req, manager), database_name: oldName, details: { from: oldName, to: body.name }, ip: getClientIp(req) });
    return jsonResponse({ data: { name: body.name } });
  });

  router.delete("/api/databases/:name", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    manager.deleteDatabase(params.name);
    logActivity(manager, { action: "database.delete", admin_id: getAdminId(req, manager), database_name: params.name, ip: getClientIp(req) });
    return jsonResponse({ data: { deleted: true } });
  });
}
