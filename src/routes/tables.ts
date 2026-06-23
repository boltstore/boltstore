import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";
import { checkReadOnly } from "../middleware/readonly";
import { logActivity, getClientIp } from "./activity";

const VALID_TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;
const VALID_COLUMN_NAME = /^[a-z_][a-z0-9_]*$/i;
const VALID_TYPES = new Set(["text", "integer", "real", "blob", "numeric", "boolean", "date", "datetime"]);

interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
  auto_increment?: boolean;
  unique?: boolean;
  default?: string;
  references?: { table: string; column: string };
}

function buildCreateTableSQL(table: string, columns: ColumnDef[]): string {
  const cols = columns.map(c => {
    let sql = `"${c.name}" ${c.type.toUpperCase()}`;
    if (c.primary_key) sql += " PRIMARY KEY";
    if (c.auto_increment) sql += " AUTOINCREMENT";
    if (!c.nullable) sql += " NOT NULL";
    if (c.unique) sql += " UNIQUE";
    if (c.default !== undefined) sql += ` DEFAULT ${c.default}`;
    if (c.references) sql += ` REFERENCES "${c.references.table}"("${c.references.column}")`;
    return sql;
  });
  return `CREATE TABLE "${table}" (${cols.join(", ")})`;
}

export function registerTableRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/databases/:db/tables", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const pool = manager.get(params.db);
    const db = pool.read();
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*' AND name != 'sqlite_sequence' ORDER BY name").all() as { name: string }[];
    return jsonResponse({ data: tables.map(t => t.name) });
  });

  router.post("/api/databases/:db/tables", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const body = await req.json() as { name?: string; columns?: ColumnDef[] };
    if (!body.name || !VALID_TABLE_NAME.test(body.name)) {
      return errorResponse("VALIDATION", "Invalid table name.", 400);
    }
    if (!body.columns || !Array.isArray(body.columns) || body.columns.length === 0) {
      return errorResponse("VALIDATION", "At least one column is required.", 400);
    }
    for (const col of body.columns) {
      if (!VALID_COLUMN_NAME.test(col.name)) return errorResponse("VALIDATION", `Invalid column name: "${col.name}".`, 400);
      if (!VALID_TYPES.has(col.type.toLowerCase())) return errorResponse("VALIDATION", `Invalid column type: "${col.type}". Must be one of: ${Array.from(VALID_TYPES).join(", ")}`, 400);
    }

    const pool = manager.get(params.db);
    const sql = buildCreateTableSQL(body.name, body.columns);
    try {
      pool.write().run(sql);
      logActivity(manager, { action: "table.create", database_name: params.db, target: body.name, details: { columns: body.columns.length }, ip: getClientIp(req) });
      return jsonResponse({ data: { name: body.name, columns: body.columns } }, 201);
    } catch (err: any) {
      return errorResponse("ERROR", err.message || "Failed to create table.", 400);
    }
  });

  router.get("/api/databases/:db/tables/:table", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

    const pool = manager.get(params.db);
    const db = pool.read();
    const columns = db.query(`PRAGMA table_info('${params.table.replace(/'/g, "''")}')`).all();
    if (!columns || (columns as any[]).length === 0) {
      return errorResponse("NOT_FOUND", `Table "${params.table}" not found.`, 404);
    }
    return jsonResponse({ data: { name: params.table, columns } });
  });

  router.patch("/api/databases/:db/tables/:table", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const body = await req.json() as { name?: string; add_columns?: ColumnDef[]; drop_columns?: string[]; rename_column?: { from: string; to: string } };
    const pool = manager.get(params.db);
    const writeDb = pool.write();

    if (body.name && body.name !== params.table) {
      if (!VALID_TABLE_NAME.test(body.name)) {
        return errorResponse("VALIDATION", "Invalid table name.", 400);
      }
      try {
        writeDb.run(`ALTER TABLE "${params.table}" RENAME TO "${body.name}"`);
        logActivity(manager, { action: "table.rename", database_name: params.db, target: body.name, details: { from: params.table, to: body.name }, ip: getClientIp(req) });
      } catch (err: any) {
        return errorResponse("ERROR", err.message || "Failed to rename table.", 400);
      }
      return jsonResponse({ data: { name: body.name } });
    }

    if (body.add_columns) {
      for (const col of body.add_columns) {
        if (!VALID_COLUMN_NAME.test(col.name)) return errorResponse("VALIDATION", `Invalid column name: "${col.name}".`, 400);
        let sql = `ALTER TABLE "${params.table}" ADD COLUMN "${col.name}" ${col.type.toUpperCase()}`;
        if (!col.nullable) sql += " NOT NULL";
        if (col.default !== undefined) sql += ` DEFAULT ${col.default}`;
        writeDb.run(sql);
      }
    }
    if (body.drop_columns) {
      for (const col of body.drop_columns) {
        try {
          writeDb.run(`ALTER TABLE "${params.table}" DROP COLUMN "${col}"`);
        } catch {}
      }
    }
    if (body.rename_column) {
      try {
        writeDb.run(`ALTER TABLE "${params.table}" RENAME COLUMN "${body.rename_column.from}" TO "${body.rename_column.to}"`);
      } catch {}
    }

    return jsonResponse({ data: { altered: true } });
  });

  router.delete("/api/databases/:db/tables/:table", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const pool = manager.get(params.db);
    pool.write().run(`DROP TABLE IF EXISTS "${params.table}"`);
    logActivity(manager, { action: "table.delete", database_name: params.db, target: params.table, ip: getClientIp(req) });
    return jsonResponse({ data: { deleted: true } });
  });
}
