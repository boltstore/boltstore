import { DatabasePool } from "../db/pool";
import { validateIdentifier } from "@boltstore/utils";
import { toBindings } from "../db/cast";
import { applyRLS, toRLSContext, type RLSContext } from "../rls";
import type { AuthContext } from "../middleware/auth";
import { getColumnNames, MAX_LIMIT, MAX_OFFSET } from "./schema-cache";
import { countRecords } from "./count";

interface ListRecordsResult {
  records: Record<string, unknown>[];
  meta: {
    total?: number;
    page?: number;
    per_page?: number;
    total_pages?: number;
    next_cursor?: string | null;
  };
}

interface PaginationMetaOptions {
  page: number;
  perPage: number;
  filter?: Record<string, unknown>;
  sort?: string;
}

function listRecords(
  pool: DatabasePool,
  collection: string,
  options?: {
    filter?: Record<string, unknown>;
    sort?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
    page?: number;
    perPage?: number;
    cursor?: string;
    fields?: string[];
  },
  auth?: AuthContext
): Record<string, unknown>[] {
  getColumnNames(pool, collection);
  const db = pool.read();

  let limit = options?.limit;
  let offset = options?.offset;
  let page: number | undefined;
  let perPage: number | undefined;
  if (options?.page !== undefined && options?.perPage !== undefined) {
    page = options.page;
    perPage = options.perPage;
    limit = perPage;
    offset = (page - 1) * perPage;
  }

  if (limit !== undefined) {
    limit = Math.max(1, Math.min(limit, MAX_LIMIT));
  }
  if (offset !== undefined) {
    offset = Math.max(0, Math.min(offset, MAX_OFFSET));
  }

  const selectCols = options?.fields?.length
    ? options.fields.map((f) => `"${f}"`).join(", ")
    : "*";

  let sql = `SELECT ${selectCols} FROM "${collection}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  const rlsCtx = auth ? toRLSContext(auth) : null;
  const rls = rlsCtx ? applyRLS(pool, collection, "read", rlsCtx) : null;
  if (rls?.whereClause) {
    conditions.push(rls.whereClause);
    params.push(...rls.params);
  }

  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        throw Object.assign(new Error(`Filter value for "${key}" must be a scalar or array.`), { status: 400 });
      }
      validateIdentifier(key, "filter field");
      conditions.push(`"${key}" = ?`);
      params.push(value);
    }
  }

  const sortField = options?.sort || "created_at";
  validateIdentifier(sortField, "sort field");
  if (options?.cursor) {
    const op = options.direction === "asc" ? ">" : "<";
    conditions.push(`"${sortField}" ${op} ?`);
    params.push(options.cursor);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  const direction = options?.direction === "asc" ? "ASC" : "DESC";
  sql += ` ORDER BY "${sortField}" ${direction}`;

  if (limit !== undefined) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  if (offset !== undefined) {
    sql += ` OFFSET ?`;
    params.push(offset);
  }

  const records = db.query(sql).all(...toBindings(params)) as Record<string, unknown>[];
  return records;
}

function buildListSql(
  collection: string,
  options?: {
    filter?: Record<string, unknown>;
    sort?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
    cursor?: string;
    fields?: string[];
  }
): { sql: string; params: unknown[] } {
  validateIdentifier(collection, "collection name");
  const selectCols = options?.fields?.length
    ? options.fields.map((f) => `"${f}"`).join(", ")
    : "*";
  let sql = `SELECT ${selectCols} FROM "${collection}"`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        throw Object.assign(new Error(`Filter value for "${key}" must be a scalar or array.`), { status: 400 });
      }
      validateIdentifier(key, "filter field");
      conditions.push(`"${key}" = ?`);
      params.push(value);
    }
  }

  const sortField = options?.sort || "created_at";
  validateIdentifier(sortField, "sort field");
  if (options?.cursor) {
    const op = options.direction === "asc" ? ">" : "<";
    conditions.push(`"${sortField}" ${op} ?`);
    params.push(options.cursor);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  const direction = options?.direction === "asc" ? "ASC" : "DESC";
  sql += ` ORDER BY "${sortField}" ${direction}`;

  let limit = options?.limit;
  let offset = options?.offset;
  if (limit !== undefined) {
    limit = Math.max(1, Math.min(limit, MAX_LIMIT));
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  if (offset !== undefined) {
    offset = Math.max(0, Math.min(offset, MAX_OFFSET));
    sql += ` OFFSET ?`;
    params.push(offset);
  }

  return { sql, params };
}

function buildPaginationMeta(
  pool: DatabasePool,
  collection: string,
  options: PaginationMetaOptions,
  auth?: AuthContext,
  lastRecord?: Record<string, unknown>
): ListRecordsResult["meta"] {
  const total = countRecords(pool, collection, options.filter, auth);
  const meta: ListRecordsResult["meta"] = {
    total,
    page: options.page,
    per_page: options.perPage,
    total_pages: Math.ceil(total / options.perPage),
  };
  if (lastRecord) {
    const key = options.sort || "created_at";
    meta.next_cursor = lastRecord[key] as string | null;
  }
  return meta;
}

export { listRecords, buildListSql, buildPaginationMeta, ListRecordsResult, PaginationMetaOptions };
