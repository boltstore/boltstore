import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";

const VALID_TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;
const VALID_COLUMN_NAME = /^[a-z_][a-z0-9_]*$/i;
const VALID_TYPES = new Set(["text", "integer", "real", "blob", "numeric", "boolean", "date", "datetime"]);

interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
  unique?: boolean;
  default?: string;
  references?: { table: string; column: string };
}

function buildCreateTableSQL(table: string, columns: ColumnDef[]): string {
  const cols = columns.map(c => {
    let sql = `"${c.name}" ${c.type.toUpperCase()}`;
    if (!c.nullable) sql += " NOT NULL";
    if (c.primary_key) sql += " PRIMARY KEY";
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
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%' ORDER BY name").all() as { name: string }[];
    return jsonResponse({ data: tables.map(t => t.name) });
  });

  router.post("/api/databases/:db/tables", async (req, params) => {
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;

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

    const body = await req.json() as { add_columns?: ColumnDef[]; drop_columns?: string[]; rename_column?: { from: string; to: string } };
    const pool = manager.get(params.db);
    const writeDb = pool.write();

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

    const pool = manager.get(params.db);
    pool.write().run(`DROP TABLE IF EXISTS "${params.table}"`);
    return jsonResponse({ data: { deleted: true } });
  });
}
