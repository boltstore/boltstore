import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";
import { logger } from "../logger";
import { validateDbName, isValidDbName } from "../validation";
import { rmSync } from "node:fs";

export function registerDatabaseRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/databases", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const databases = manager.listDatabases();
    return jsonResponse({ data: databases });
  });

  router.post("/api/databases", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await parseJsonBody<{ name?: string; group?: string }>(req); if (body instanceof Response) return body;
    if (!body.name) {
      return errorResponse("VALIDATION", "Database name is required.", 400);
    }
    const nameErr = validateDbName(body.name);
    if (nameErr) return nameErr;
    const info = manager.createDatabase(body.name, body.group);
    logActivity(manager, { action: "database.create", admin_id: await getAdminId(req, manager), database_name: body.name, details: body.group ? { group: body.group } : undefined, ip: getClientIp(req) });
    return jsonResponse({ data: info }, 201);
  });

  router.get("/api/databases/:name", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    try {
      const pool = manager.get(params.name);
      const db = pool.read();
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[];
      const info = manager.listDatabases().find(d => d.name === params.name);
      if (!info) return errorResponse("NOT_FOUND", "Database not found.", 404);
      return jsonResponse({ data: { ...info, tables: tables.map(t => t.name) } });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) return errorResponse("NOT_FOUND", "Database not found.", 404);
      logger.warn("Database detail failed", { database: params.name, error: err instanceof Error ? err.message : String(err) });
      return errorResponse("DATABASE_ERROR", "Failed to load database details.", 500);
    }
  });

  router.patch("/api/databases/:name", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const oldNameErr = validateDbName(params.name);
    if (oldNameErr) return oldNameErr;
    const body = await parseJsonBody<{ name?: string }>(req); if (body instanceof Response) return body;
    if (!body.name) {
      return errorResponse("VALIDATION", "New database name is required.", 400);
    }
    const newNameErr = validateDbName(body.name);
    if (newNameErr) return newNameErr;
    const oldName = params.name;

    const metaPool = manager.getMetaPool();
    const row = metaPool.read().query("SELECT file_path FROM _databases WHERE name = ?").get(oldName) as { file_path: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);

    const newPath = row.file_path.replace(oldName, body.name);
    const pool = manager.get(oldName);

    try {
      pool.write().run(`VACUUM INTO '${newPath.replace(/'/g, "''")}'`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("VACUUM INTO failed during rename", { database: oldName, error: msg });
      return errorResponse("DATABASE_ERROR", "Failed to copy database file during rename.", 500);
    }

    const metaWrite = metaPool.write();
    metaWrite.run("BEGIN");
    metaWrite.run("PRAGMA defer_foreign_keys = ON");
    metaWrite.run("UPDATE _databases SET name = ?, file_path = ? WHERE name = ?", [body.name, newPath, oldName]);
    metaWrite.run("UPDATE _api_keys SET database_name = ? WHERE database_name = ?", [body.name, oldName]);
    metaWrite.run("COMMIT");

    manager.closePool(oldName);
    try { rmSync(row.file_path); } catch (err) { logger.warn("Failed to remove old db file", { path: row.file_path, error: err instanceof Error ? err.message : String(err) }); }
    try { rmSync(row.file_path + "-wal", { force: true }); } catch {}
    try { rmSync(row.file_path + "-shm", { force: true }); } catch {}

    logActivity(manager, { action: "database.rename", admin_id: await getAdminId(req, manager), database_name: oldName, details: { from: oldName, to: body.name }, ip: getClientIp(req) });
    return jsonResponse({ data: { name: body.name } });
  });

  router.delete("/api/databases/:name", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    if (!isValidDbName(params.name)) {
      return errorResponse("VALIDATION", "Invalid database name.", 400);
    }
    manager.deleteDatabase(params.name);
    logActivity(manager, { action: "database.delete", admin_id: await getAdminId(req, manager), database_name: params.name, ip: getClientIp(req) });
    return jsonResponse({ data: { deleted: true } });
  });
}