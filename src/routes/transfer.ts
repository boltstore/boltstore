import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity } from "./activity";

export function registerTransferRoutes(router: Router, manager: DatabaseManager): void {
  const dataDir = manager.getDataDir();

  router.post("/api/databases/:name/export", async (req, params) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);

    const pool = manager.get(params.name);
    const exportPath = `${dataDir}/${params.name}_export.db`;

    try {
      pool.write().run(`VACUUM INTO '${exportPath.replace(/'/g, "''")}'`);
      const file = Bun.file(exportPath);
      const bytes = await file.bytes();

      // Clean up temp file
      try { require("node:fs").rmSync(exportPath); } catch {}

      logActivity(manager, { action: "database.export", database_name: params.name, ip: req.headers.get("x-forwarded-for") || undefined });
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${params.name}.db"`,
        },
      });
    } catch (err: any) {
      return errorResponse("ERROR", err.message || "Export failed.", 500);
    }
  });

  router.post("/api/databases/import", async (req) => {
    if (!isAdminRequest(req)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);

    const form = await req.formData();
    const fileField = form.get("file");
    const nameField = form.get("name");

    if (!fileField || !(fileField instanceof File)) {
      return errorResponse("VALIDATION", "File is required.", 400);
    }

    const dbName = typeof nameField === "string" && nameField.length > 0
      ? nameField
      : fileField.name.replace(/\.(db|sqlite|sqlite3)$/i, "");

    const validName = /^[a-z0-9][a-z0-9_-]*$/;
    if (!validName.test(dbName)) {
      return errorResponse("VALIDATION", "Database name must match ^[a-z0-9][a-z0-9_-]*$", 400);
    }

    const destPath = `${dataDir}/${dbName}.db`;
    const bytes = await fileField.bytes();

    // Validate it's a valid SQLite file
    if (bytes.length < 100 || (bytes[0] !== 0x53 && bytes[0] !== 0x73)) { // 'S' or 's' (SQLite header or SQL text)
      return errorResponse("VALIDATION", "File does not appear to be a valid SQLite database.", 400);
    }

    try {
      await Bun.write(destPath, bytes);
    } catch (err: any) {
      return errorResponse("ERROR", err.message || "Failed to write database file.", 500);
    }

    try {
      const pool = manager.get(dbName);
      pool.read().query("PRAGMA integrity_check").get();
    } catch {
      try { require("node:fs").rmSync(destPath); } catch {}
      return errorResponse("VALIDATION", "Imported file failed integrity check.", 400);
    }

    logActivity(manager, { action: "database.import", database_name: dbName, ip: req.headers.get("x-forwarded-for") || undefined });
    return jsonResponse({ data: { name: dbName, file: fileField.name } }, 201);
  });
}
