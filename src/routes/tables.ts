import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { authenticateApiKey, checkDbCors } from "../middleware/auth";
import { checkReadOnly } from "../middleware/readonly";
import { logActivity, getClientIp } from "./activity";
import { logger } from "../logger";
import { isValidIdentifier, validateIdentifier, validateIdentifiers, validateColumnDefault, validateDbName } from "../validation";

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

function validateColumnDef(col: ColumnDef): Response | null {
  const nameErr = validateIdentifier(col.name, "column");
  if (nameErr) return nameErr;
  if (!col.type || !VALID_TYPES.has(col.type.toLowerCase())) {
    return errorResponse("VALIDATION", `Invalid column type: "${col.type}". Must be one of: ${Array.from(VALID_TYPES).join(", ")}`, 400);
  }
  if (col.default !== undefined) {
    const defErr = validateColumnDefault(col.default);
    if (defErr) return defErr;
  }
  if (col.references) {
    const refTableErr = validateIdentifier(col.references.table, "table");
    if (refTableErr) return refTableErr;
    const refColErr = validateIdentifier(col.references.column, "column");
    if (refColErr) return refColErr;
  }
  return null;
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
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const pool = manager.get(params.db);
    const db = pool.read();
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*' AND name != 'sqlite_sequence' ORDER BY name").all() as { name: string }[];
    return jsonResponse({ data: tables.map(t => t.name) });
  });

  router.post("/api/databases/:db/tables", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const body = await parseJsonBody<{ name?: string; columns?: ColumnDef[] }>(req); if (body instanceof Response) return body;
    if (!body.name) {
      return errorResponse("VALIDATION", "Table name is required.", 400);
    }
    const nameErr = validateIdentifier(body.name, "table");
    if (nameErr) return nameErr;
    if (!body.columns || !Array.isArray(body.columns) || body.columns.length === 0) {
      return errorResponse("VALIDATION", "At least one column is required.", 400);
    }
    for (const col of body.columns) {
      const colErr = validateColumnDef(col);
      if (colErr) return colErr;
    }

    const pool = manager.get(params.db);
    const sql = buildCreateTableSQL(body.name, body.columns);
    try {
      pool.write().run(sql);
      logActivity(manager, { action: "table.create", database_name: params.db, database_id: manager.resolveDbId(params.db), target: body.name, details: { columns: body.columns.length }, ip: getClientIp(req) });
      return jsonResponse({ data: { name: body.name, columns: body.columns } }, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Table creation failed", { database: params.db, error: msg });
      return errorResponse("TABLE_ERROR", "Failed to create table. Check your schema definition.", 400);
    }
  });

  router.get("/api/databases/:db/tables/schema", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    try {
      const pool = manager.get(params.db);
      const db = pool.read();
      const tableNames = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*' AND name != 'sqlite_sequence' ORDER BY name"
      ).all() as { name: string }[];

      const schemas = tableNames.map(({ name }) => {
        const columns = db.query(`PRAGMA table_info("${name}")`).all();
        return { name, columns };
      });

      return jsonResponse({ data: schemas });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Batch schema fetch failed", { database: params.db, error: msg });
      return errorResponse("DATABASE_ERROR", "Failed to fetch schemas.", 500);
    }
  });

  router.get("/api/databases/:db/tables/:table", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const pool = manager.get(params.db);
    const db = pool.read();
    const columns = db.query(`PRAGMA table_info("${params.table}")`).all();
    if (!columns || columns.length === 0) {
      return errorResponse("NOT_FOUND", `Table "${params.table}" not found.`, 404);
    }
    return jsonResponse({ data: { name: params.table, columns } });
  });

  router.patch("/api/databases/:db/tables/:table", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const body = await parseJsonBody<{ name?: string; add_columns?: ColumnDef[]; drop_columns?: string[]; rename_column?: { from: string; to: string } }>(req); if (body instanceof Response) return body;
    const pool = manager.get(params.db);
    const writeDb = pool.write();

    if (body.name && body.name !== params.table) {
      const newNameErr = validateIdentifier(body.name, "table");
      if (newNameErr) return newNameErr;
      try {
        writeDb.run(`ALTER TABLE "${params.table}" RENAME TO "${body.name}"`);
        logActivity(manager, { action: "table.rename", database_name: params.db, database_id: manager.resolveDbId(params.db), target: body.name, details: { from: params.table, to: body.name }, ip: getClientIp(req) });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("Table rename failed", { database: params.db, error: msg });
        return errorResponse("TABLE_ERROR", "Failed to rename table.", 400);
      }
      return jsonResponse({ data: { name: body.name } });
    }

    if (body.add_columns) {
      for (const col of body.add_columns) {
        const colErr = validateColumnDef(col);
        if (colErr) return colErr;
        let sql = `ALTER TABLE "${params.table}" ADD COLUMN "${col.name}" ${col.type.toUpperCase()}`;
        if (!col.nullable) sql += " NOT NULL";
        if (col.default !== undefined) sql += ` DEFAULT ${col.default}`;
        try {
          writeDb.run(sql);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("Add column failed", { database: params.db, table: params.table, column: col.name, error: msg });
          return errorResponse("TABLE_ERROR", `Failed to add column "${col.name}".`, 400);
        }
      }
    }
    if (body.drop_columns) {
      const dropErr = validateIdentifiers(body.drop_columns, "column");
      if (dropErr) return dropErr;
      for (const col of body.drop_columns) {
        try {
          writeDb.run(`ALTER TABLE "${params.table}" DROP COLUMN "${col}"`);
        } catch (err: unknown) {
          logger.warn("Drop column failed", { database: params.db, table: params.table, column: col, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    if (body.rename_column) {
      const fromErr = validateIdentifier(body.rename_column.from, "column");
      if (fromErr) return fromErr;
      const toErr = validateIdentifier(body.rename_column.to, "column");
      if (toErr) return toErr;
      try {
        writeDb.run(`ALTER TABLE "${params.table}" RENAME COLUMN "${body.rename_column.from}" TO "${body.rename_column.to}"`);
      } catch (err: unknown) {
        logger.warn("Rename column failed", { database: params.db, table: params.table, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return jsonResponse({ data: { altered: true } });
  });

  router.delete("/api/databases/:db/tables/:table", async (req, params) => {
    const corsCheck = checkDbCors(req, manager, params.db);
    if (corsCheck) return corsCheck;
    const auth = await authenticateApiKey(req, manager, params.db);
    if (auth instanceof Response) return auth;
    const ro = checkReadOnly(manager, params.db);
    if (ro) return ro;

    const tableErr = validateIdentifier(params.table, "table");
    if (tableErr) return tableErr;

    const pool = manager.get(params.db);
    pool.write().run(`DROP TABLE IF EXISTS "${params.table}"`);
    logActivity(manager, { action: "table.delete", database_name: params.db, database_id: manager.resolveDbId(params.db), target: params.table, ip: getClientIp(req) });
    return jsonResponse({ data: { deleted: true } });
  });
}