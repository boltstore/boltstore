import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";
import { logger } from "../logger";
import { validateDbName, isValidDbName } from "../validation";
import { rmSync } from "node:fs";

const MAX_IMPORT_BYTES = 1024 * 1024 * 1024; // 1 GB cap on import

export function registerTransferRoutes(router: Router, manager: DatabaseManager): void {
  const dataDir = manager.getDataDir();

  router.post("/api/databases/:name/export", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    if (!isValidDbName(params.name)) {
      return errorResponse("VALIDATION", "Invalid database name.", 400);
    }

    const pool = manager.get(params.name);
    const exportPath = `${dataDir}/${params.name}_export.db`;

    try {
      pool.write().run(`VACUUM INTO '${exportPath.replace(/'/g, "''")}'`);
      const file = Bun.file(exportPath);
      const bytes = await file.bytes();

      try { rmSync(exportPath); } catch {}

      logActivity(manager, { action: "database.export", admin_id: await getAdminId(req, manager), database_name: params.name, ip: getClientIp(req) });
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${params.name}.db"`,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Database export failed", { database: params.name, error: msg });
      try { rmSync(exportPath, { force: true }); } catch {}
      return errorResponse("EXPORT_ERROR", "Export failed.", 500);
    }
  });

  router.post("/api/databases/import", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);

    const form = await req.formData();
    const fileField = form.get("file");
    const nameField = form.get("name");
    const groupField = form.get("group");

    if (!fileField || !(fileField instanceof File)) {
      return errorResponse("VALIDATION", "File is required.", 400);
    }

    if (fileField.size > MAX_IMPORT_BYTES) {
      return errorResponse("PAYLOAD_TOO_LARGE", `Import file exceeds ${MAX_IMPORT_BYTES / 1024 / 1024}MB limit.`, 413);
    }

    const dbName = typeof nameField === "string" && nameField.length > 0
      ? nameField
      : fileField.name.replace(/\.(db|sqlite|sqlite3)$/i, "");

    const nameErr = validateDbName(dbName);
    if (nameErr) return nameErr;

    const metaPool = manager.getMetaPool();
    const existing = metaPool.read().query("SELECT 1 FROM _databases WHERE name = ?").get(dbName);
    if (existing) {
      return errorResponse("CONFLICT", `Database "${dbName}" already exists.`, 409);
    }

    const destPath = `${dataDir}/${dbName}.db`;
    const bytes = await fileField.bytes();

    // Validate it's a valid SQLite file (header: "SQLite format 3\0")
    if (bytes.length < 100 || bytes[0] !== 0x53) {
      return errorResponse("VALIDATION", "File does not appear to be a valid SQLite database.", 400);
    }

    try {
      await Bun.write(destPath, bytes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Import file write failed", { path: destPath, error: msg });
      return errorResponse("IMPORT_ERROR", "Failed to write database file.", 500);
    }

    // Register so manager.get() can find it, then validate integrity
    try {
      const group = typeof groupField === "string" && groupField.length > 0 ? groupField : undefined;
      const pool = manager.registerDatabase(dbName, destPath, group);
      const integrity = pool.read().query("PRAGMA integrity_check").get() as { integrity_check: string } | null;
      if (!integrity || integrity.integrity_check !== "ok") {
        throw new Error(`integrity_check returned: ${integrity?.integrity_check ?? "null"}`);
      }
    } catch (err: unknown) {
      logger.warn("Imported file failed integrity check", { database: dbName, error: err instanceof Error ? err.message : String(err) });
      try { rmSync(destPath, { force: true }); } catch {}
      // Best-effort: unregister the database row so it doesn't linger
      try { metaPool.write().run("DELETE FROM _databases WHERE name = ?", [dbName]); } catch {}
      return errorResponse("VALIDATION", "Imported file failed integrity check.", 400);
    }

    logActivity(manager, { action: "database.import", admin_id: await getAdminId(req, manager), database_name: dbName, details: { file: fileField.name }, ip: getClientIp(req) });
    return jsonResponse({ data: { name: dbName, file: fileField.name } }, 201);
  });
}