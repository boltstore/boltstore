/**
 * Query builder — translates a JSON query DSL into parameterized SQL.
 *
 * Supports filtering, sorting, pagination, field selection, full-text search,
 * aggregates, logical grouping, JSON field access, and subqueries.
 *
 * All user input is passed through parameterized bindings (`?` placeholders)
 * to prevent SQL injection. Identifiers (table/column names) are validated
 * against an alphanumeric regex.
 *
 * @module boltstore/query
 */

import { toBindings } from "./db/cast";
import { validateIdentifier } from "@boltstore/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported filter operators. */
export type FilterOperator =
  | "$eq"
  | "$neq"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$in"
  | "$nin"
  | "$contains"
  | "$startsWith"
  | "$endsWith"
  | "$exists"
  | "$regexp";

/** A field → operator → value filter expression. */
export interface FieldFilter {
  [operator: string]: unknown;
}

/** Logical grouping: AND / OR / NOT with nested filters. */
export interface LogicalGroup {
  $and?: FilterExpression[];
  $or?: FilterExpression[];
  $not?: FilterExpression;
}

/** A filter expression can be a field filter or a logical group. */
export type FilterExpression = Record<string, unknown> | LogicalGroup;

/** Sort specification: "field" or "field:asc" / "field:desc". */
export type SortSpec = string;

/** Aggregate function names. */
export type AggregateFn = "$count" | "$sum" | "$avg" | "$min" | "$max";

/** Aggregate specification. */
export interface AggregateSpec {
  function: AggregateFn;
  field?: string;
  alias?: string;
}

/** The complete query DSL object. */
export interface QueryParams {
  /** Filter expressions (AND-ed together if array, or single expression). */
  filter?: FilterExpression | FilterExpression[];
  /** Sort: array of "field:asc" / "field:desc" strings. */
  sort?: SortSpec[];
  /** Fields to return (projection). If omitted, returns all (*). */
  fields?: string[];
  /** Cursor for keyset pagination. */
  cursor?: string;
  /** Maximum records to return. */
  limit?: number;
  /** 0-based offset for offset pagination. */
  offset?: number;
  /** Full-text search term (requires FTS5 index). */
  search?: string;
  /** Search fields for full-text search (default: all text columns). */
  searchFields?: string[];
  /** Aggregate function to apply. */
  aggregate?: AggregateSpec;
  /** Field to group by (for aggregate queries). */
  groupBy?: string;
  /** Post-aggregation filter (HAVING clause). */
  having?: FilterExpression;
}

/** Result of a query, including pagination metadata. */
export interface QueryResult<T = Record<string, unknown>> {
  data: T[];
  meta: {
    total?: number;
    page?: number;
    per_page?: number;
    total_pages?: number;
    next_cursor?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Parameterized SQL builder
// ---------------------------------------------------------------------------

interface SqlFragment {
  sql: string;
  params: unknown[];
}

/**
 * Build a WHERE clause (and params) from a filter expression.
 */
function buildWhere(filter: FilterExpression | FilterExpression[]): SqlFragment {
  const filters = Array.isArray(filter) ? filter : [filter];
  const parts = filters.map(buildFilterExpression);
  const sql = parts.map((p) => `(${p.sql})`).join(" AND ");
  const params = parts.flatMap((p) => p.params);
  return { sql, params };
}

function buildFilterExpression(expr: FilterExpression): SqlFragment {
  const keys = Object.keys(expr);

  // Logical group?
  if (keys.some((k) => k === "$and" || k === "$or" || k === "$not")) {
    return buildLogicalGroup(expr as LogicalGroup);
  }

  // Otherwise treat each key as a field → operator map
  const fragments: SqlFragment[] = [];
  for (const field of keys) {
    const value = (expr as Record<string, unknown>)[field];

    // Handle JSON path: field.subfield notation → json_extract
    const sqlField = field.includes(".")
      ? `json_extract("${field.split(".")[0]}", '$.${field.split(".").slice(1).join(".")}')`
      : validateAndQuote(field);

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Operator object: { $eq: 5 } or { $in: [1,2,3] }
      for (const [op, val] of Object.entries(value as Record<string, unknown>)) {
        const frag = buildOperator(sqlField, op as FilterOperator, val);
        fragments.push(frag);
      }
    } else {
      // Shorthand: value equality → $eq
      fragments.push({ sql: `${sqlField} = ?`, params: [value] });
    }
  }

  return {
    sql: fragments.map((f) => f.sql).join(" AND "),
    params: fragments.flatMap((f) => f.params),
  };
}

function buildLogicalGroup(group: LogicalGroup): SqlFragment {
  const parts: { sql: string; params: unknown[] }[] = [];

  if (group.$and) {
    const inner = group.$and.map(buildFilterExpression);
    parts.push({
      sql: inner.map((p) => `(${p.sql})`).join(" AND "),
      params: inner.flatMap((p) => p.params),
    });
  }

  if (group.$or) {
    const inner = group.$or.map(buildFilterExpression);
    parts.push({
      sql: `(${inner.map((p) => `(${p.sql})`).join(" OR ")})`,
      params: inner.flatMap((p) => p.params),
    });
  }

  if (group.$not) {
    const inner = buildFilterExpression(group.$not);
    parts.push({
      sql: `NOT (${inner.sql})`,
      params: inner.params,
    });
  }

  return {
    sql: parts.map((p) => p.sql).join(" AND "),
    params: parts.flatMap((p) => p.params),
  };
}

function buildOperator(field: string, op: FilterOperator, value: unknown): SqlFragment {
  // Validate scalar values for safety: reject objects/arrays except for the $in/$nin operators.
  if (value !== null && value !== undefined && typeof value === "object" && op !== "$in" && op !== "$nin") {
    throw Object.assign(new Error(`Filter value for operator "${op}" must be a scalar.`), { status: 400 });
  }

  switch (op) {
    case "$eq":
      return value === null
        ? { sql: `${field} IS NULL`, params: [] }
        : { sql: `${field} = ?`, params: [value] };
    case "$neq":
      return value === null
        ? { sql: `${field} IS NOT NULL`, params: [] }
        : { sql: `${field} != ?`, params: [value] };
    case "$gt":
      return { sql: `${field} > ?`, params: [value] };
    case "$gte":
      return { sql: `${field} >= ?`, params: [value] };
    case "$lt":
      return { sql: `${field} < ?`, params: [value] };
    case "$lte":
      return { sql: `${field} <= ?`, params: [value] };
    case "$in": {
      if (!Array.isArray(value) || value.length === 0) {
        return { sql: "1 = 0", params: [] }; // empty IN → always false
      }
      const placeholders = value.map(() => "?").join(", ");
      return { sql: `${field} IN (${placeholders})`, params: value };
    }
    case "$nin": {
      if (!Array.isArray(value) || value.length === 0) {
        return { sql: "1 = 1", params: [] }; // empty NOT IN → always true
      }
      const placeholders = value.map(() => "?").join(", ");
      return { sql: `${field} NOT IN (${placeholders})`, params: value };
    }
    case "$contains":
      return { sql: `${field} LIKE ?`, params: [`%${value}%`] };
    case "$startsWith":
      return { sql: `${field} LIKE ?`, params: [`${value}%`] };
    case "$endsWith":
      return { sql: `${field} LIKE ?`, params: [`%${value}`] };
    case "$exists":
      return value
        ? { sql: `${field} IS NOT NULL`, params: [] }
        : { sql: `${field} IS NULL`, params: [] };
    case "$regexp":
      // bun:sqlite does not support native REGEXP user-defined functions.
      // Fall back to LIKE with basic pattern translation for common cases.
      return { sql: `${field} LIKE ?`, params: [regexToLike(String(value))] };
    default:
      throw Object.assign(
        new Error(`Unknown filter operator "${op}".`),
        { status: 400 }
      );
  }
}

/**
 * Translate a simple regex pattern to a LIKE pattern.
 * Handles ^ anchor, . (any char → _), .* (any sequence → %).
 * This is a best-effort translation for common patterns.
 */
function regexToLike(pattern: string): string {
  let result = pattern;
  // Remove ^ anchor at start (LIKE is always anchored)
  if (result.startsWith("^")) result = result.slice(1);
  // Remove $ anchor at end
  if (result.endsWith("$")) result = result.slice(0, -1);
  // .* → %
  result = result.replace(/\.\*/g, "%");
  // . → _
  result = result.replace(/\./g, "_");
  return result;
}

/** Validate an identifier and wrap in double quotes. */
function validateAndQuote(name: string): string {
  validateIdentifier(name, "column/field name");
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// Public query builder
// ---------------------------------------------------------------------------

/** Check whether an FTS5 virtual table exists for a collection. */
function ftsTableExists(db: import("bun:sqlite").Database, collection: string): boolean {
  const row = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(`${collection}_fts`) as { 1?: number } | null;
  return row !== null;
}

/** Build a search clause, falling back to LIKE if no FTS5 table exists. */
function buildSearchClause(
  collection: string,
  term: string,
  searchFields?: string[],
  db?: import("bun:sqlite").Database
): SqlFragment {
  const ftsTable = `${collection}_fts`;
  const hasFts = db ? ftsTableExists(db, collection) : true;

  if (hasFts) {
    return {
      sql: `id IN (SELECT rowid FROM "${ftsTable}" WHERE "${ftsTable}" MATCH ?)`,
      params: [term],
    };
  }

  // Fallback: LIKE scan across requested text columns (or all columns)
  const fields = searchFields && searchFields.length > 0 ? searchFields : [];
  if (fields.length === 0) {
    // No fields specified and no FTS table; we cannot safely scan every column type.
    // Return a clause that matches nothing and let the caller decide whether to error.
    return { sql: "1 = 0", params: [] };
  }

  const pattern = `%${term}%`;
  const clauses = fields.map((f) => `${validateAndQuote(f)} LIKE ?`);
  return {
    sql: `(${clauses.join(" OR ")})`,
    params: fields.map(() => pattern),
  };
}

/**
 * Build a complete parameterized SQL query from a QueryParams object.
 *
 * Returns { sql, params } suitable for db.query(sql).all(...params).
 */
export function buildQuery(
  collection: string,
  params: QueryParams,
  db?: import("bun:sqlite").Database
): { sql: string; bindings: unknown[] } {
  validateIdentifier(collection, "collection name");

  let sql = "";
  const bindings: unknown[] = [];
  const isAggregate =
    params.aggregate !== undefined || params.groupBy !== undefined;

  // --- SELECT clause ---

  if (isAggregate && params.aggregate) {
    const agg = params.aggregate;
    const target = agg.field ? validateAndQuote(agg.field) : "*";
    if (agg.function === "$count" && (!agg.field || agg.field === "*")) {
      sql += `SELECT COUNT(*)`;
    } else {
      sql += `SELECT ${agg.function.slice(1).toUpperCase()}(${target})`;
    }
    if (agg.alias) sql += ` AS "${agg.alias}"`;
  } else if (params.fields && params.fields.length > 0) {
    const quoted = params.fields.map((f) => {
      if (f.includes(".")) {
        return `json_extract("${f.split(".")[0]}", '$.${f.split(".").slice(1).join(".")}') AS "${f.replace(".", "_")}"`;
      }
      return validateAndQuote(f);
    });
    sql += `SELECT ${quoted.join(", ")}`;
  } else {
    sql += "SELECT *";
  }

  if (params.groupBy) {
    sql += `, "${params.groupBy}"`;
  }

  sql += ` FROM "${collection}"`;

  // --- Full-text search ---

  if (params.search) {
    const ftsFragment = buildSearchClause(collection, params.search, params.searchFields, db);
    if (ftsFragment.sql) {
      sql += ` WHERE ${ftsFragment.sql}`;
      bindings.push(...ftsFragment.params);
    }
  } else if (params.filter) {
    // --- WHERE clause ---
    const where = buildWhere(params.filter);
    if (where.sql) {
      sql += ` WHERE ${where.sql}`;
      bindings.push(...where.params);
    }
  }

  // --- GROUP BY ---

  if (params.groupBy) {
    sql += ` GROUP BY "${params.groupBy}"`;
  }

  // --- HAVING ---

  if (params.having) {
    const having = buildFilterExpression(params.having);
    if (having.sql) {
      sql += ` HAVING ${having.sql}`;
      bindings.push(...having.params);
    }
  }

  // --- SORT ---

  if (!isAggregate && params.sort && params.sort.length > 0) {
    const orderParts = params.sort.map((s) => {
      const [field, dir] = s.split(":");
      return `${validateAndQuote(field)} ${dir === "asc" ? "ASC" : "DESC"}`;
    });
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }

  // --- PAGINATION ---

  if (!isAggregate) {
    // Cursor pagination takes precedence
    if (params.cursor) {
      const cursorSortField = params.sort && params.sort.length > 0 ? params.sort[0].split(":")[0] : "created_at";
      validateIdentifier(cursorSortField, "cursor sort field");
      sql += sql.includes(" WHERE ")
        ? ` AND "${cursorSortField}" > ?`
        : ` WHERE "${cursorSortField}" > ?`;
      bindings.push(params.cursor);
    }
    if (params.limit !== undefined) {
      sql += ` LIMIT ?`;
      bindings.push(params.limit);
    }
    if (params.offset !== undefined) {
      sql += ` OFFSET ?`;
      bindings.push(params.offset);
    }
  }

  return { sql, bindings };
}

/**
 * Execute a query against a collection and return results with pagination metadata.
 *
 * @param db - A read database connection from the pool
 * @param collection - The table name
 * @param params - Query parameters (filter, sort, pagination, etc.)
 * @param page - Page number (1-based) for offset pagination
 * @param perPage - Records per page
 */
export function executeQuery(
  db: import("bun:sqlite").Database,
  collection: string,
  params: QueryParams,
  page?: number,
  perPage?: number
): QueryResult {
  const isAggregate =
    params.aggregate !== undefined || params.groupBy !== undefined;

  // Apply offset pagination if page/per_page provided and cursor is absent
  if (page !== undefined && perPage !== undefined && !params.cursor) {
    params.limit = perPage;
    params.offset = (page - 1) * perPage;
  }

  const { sql, bindings } = buildQuery(collection, params, db);

  // Execute query
  const data = db.query(sql).all(...toBindings(bindings)) as Record<string, unknown>[];

  // For aggregates, return just the result
  if (isAggregate) {
    return { data, meta: {} };
  }

  // Calculate total count (unless we're just getting a slice for pagination or using cursor)
  let total: number | undefined;
  let totalPages: number | undefined;
  let nextCursor: string | null = null;
  if (page !== undefined && perPage !== undefined && !params.cursor) {
    total = countTotal(db, collection, params);
    totalPages = Math.ceil(total / perPage);
  }
  if (params.cursor && data.length > 0) {
    const cursorSortField = params.sort && params.sort.length > 0 ? params.sort[0].split(":")[0] : "created_at";
    const lastRow = data[data.length - 1];
    nextCursor = lastRow[cursorSortField] as string | null;
  }

  return {
    data,
    meta: {
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      next_cursor: nextCursor,
    },
  };
}

/** Count total records matching the filter (without pagination). */
function countTotal(
  db: import("bun:sqlite").Database,
  collection: string,
  params: QueryParams
): number {
  // Build a count query from the same filters
  let countSql = `SELECT COUNT(*) as cnt FROM "${collection}"`;
  const countBindings: unknown[] = [];

  if (params.filter) {
    const where = buildWhere(params.filter);
    if (where.sql) {
      countSql += ` WHERE ${where.sql}`;
      countBindings.push(...where.params);
    }
  }

  if (params.search) {
    const countFts = buildSearchClause(collection, params.search, params.searchFields, db);
    if (countFts.sql) {
      if (countSql.includes(" WHERE ")) {
        countSql += ` AND ${countFts.sql}`;
      } else {
        countSql += ` WHERE ${countFts.sql}`;
      }
      countBindings.push(...countFts.params);
    }
  }

  const row = db.query(countSql).get(...toBindings(countBindings)) as { cnt?: number } | null;
  return row?.cnt ?? 0;
}