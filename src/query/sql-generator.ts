import type { BuilderState, WhereClause, WhereClauseBasic, OrderClause, JoinClause, WithClause, UnionClause } from "@boltstore/utils";
import { validateIdentifier, createDefaultState } from "@boltstore/utils";
import type { SqlFragment } from "./types";

const CTE_MAX_DEPTH = 5;

interface PartialState {
  collection?: string;
  wheres?: WhereClause[];
  orders?: OrderClause[];
  limit?: number;
  offset?: number;
  fields?: string[];
  expand?: string[];
  search?: string;
  searchFields?: string[];
  aggregate?: BuilderState["aggregate"];
  groupBy?: string[];
  having?: WhereClause[];
  joins?: JoinClause[];
  withs?: WithClause[];
  unions?: UnionClause[];
}

function toFullState(partial: PartialState): BuilderState {
  return {
    ...createDefaultState(),
    collection: partial.collection,
    wheres: partial.wheres ?? [],
    orders: partial.orders ?? [],
    limit: partial.limit,
    offset: partial.offset,
    fields: partial.fields,
    expand: partial.expand,
    search: partial.search,
    searchFields: partial.searchFields,
    aggregate: partial.aggregate,
    groupBy: partial.groupBy,
    having: partial.having,
    joins: partial.joins ?? [],
    withs: partial.withs ?? [],
    unions: partial.unions ?? [],
  };
}

function quoteIdent(name: string): string {
  validateIdentifier(name, "identifier");
  return `"${name}"`;
}

function compileWhereClause(clause: WhereClause): SqlFragment {
  switch (clause.type) {
    case "basic": {
      const ident = quoteIdent(clause.field);
      switch (clause.operator) {
        case "eq":
          return clause.value === null
            ? { sql: `${ident} IS NULL`, params: [] }
            : { sql: `${ident} = ?`, params: [clause.value] };
        case "neq":
          return clause.value === null
            ? { sql: `${ident} IS NOT NULL`, params: [] }
            : { sql: `${ident} != ?`, params: [clause.value] };
        case "gt":   return { sql: `${ident} > ?`, params: [clause.value] };
        case "gte":  return { sql: `${ident} >= ?`, params: [clause.value] };
        case "lt":   return { sql: `${ident} < ?`, params: [clause.value] };
        case "lte":  return { sql: `${ident} <= ?`, params: [clause.value] };
        case "contains":
          return { sql: `${ident} LIKE ?`, params: [`%${clause.value}%`] };
        case "startsWith":
          return { sql: `${ident} LIKE ?`, params: [`${clause.value}%`] };
        case "endsWith":
          return { sql: `${ident} LIKE ?`, params: [`%${clause.value}`] };
        case "regexp":
          return { sql: `${ident} LIKE ?`, params: [regexToLike(String(clause.value))] };
    default:
      throw new Error(`Unknown basic operator: ${(clause as WhereClauseBasic).operator}`);
  }
    }

    case "in": {
      const ident = quoteIdent(clause.field);
      if (!Array.isArray(clause.value) || clause.value.length === 0) {
        return clause.operator === "in"
          ? { sql: "1 = 0", params: [] }
          : { sql: "1 = 1", params: [] };
      }
      const phs = clause.value.map(() => "?").join(", ");
      const op = clause.operator === "in" ? "IN" : "NOT IN";
      return { sql: `${ident} ${op} (${phs})`, params: clause.value };
    }

    case "null": {
      const ident = quoteIdent(clause.field);
      return clause.operator === "null"
        ? { sql: `${ident} IS NULL`, params: [] }
        : { sql: `${ident} IS NOT NULL`, params: [] };
    }

    case "between": {
      const ident = quoteIdent(clause.field);
      const [lo, hi] = clause.value;
      const op = clause.operator === "between" ? "BETWEEN" : "NOT BETWEEN";
      return { sql: `${ident} ${op} ? AND ?`, params: [lo, hi] };
    }

    case "like": {
      const ident = quoteIdent(clause.field);
      const op = clause.operator === "like" ? "LIKE" : "GLOB";
      return { sql: `${ident} ${op} ?`, params: [clause.value] };
    }

    case "exists": {
      const ident = quoteIdent(clause.field);
      return clause.operator === "exists"
        ? { sql: `${ident} IS NOT NULL`, params: [] }
        : { sql: `${ident} IS NULL`, params: [] };
    }

    case "nested": {
      const compiled = compileWheresNoSearch(clause.query);
      return { sql: `(${compiled.sql})`, params: compiled.params };
    }

    case "not": {
      const inner = compileWheresNoSearch(clause.query);
      return { sql: `NOT (${inner.sql})`, params: inner.params };
    }

    case "raw": {
      return { sql: clause.sql, params: clause.bindings ?? [] };
    }

    default:
      throw new Error(`Unknown WhereClause type: ${(clause as WhereClause).type}`);
  }
}

export function compileWheresNoSearch(wheres: WhereClause[]): SqlFragment {
  if (wheres.length === 0) return { sql: "1 = 1", params: [] };
  const groups: string[] = [];
  const allParams: unknown[] = [];
  let andGroup: string[] = [];

  const flushAnd = () => {
    if (andGroup.length > 0) {
      groups.push(andGroup.length === 1 ? andGroup[0] : `(${andGroup.join(" AND ")})`);
      andGroup = [];
    }
  };

  for (const w of wheres) {
    const part = compileWhereClause(w);
    if (w.boolean === "or") {
      flushAnd();
      groups.push(part.sql);
      allParams.push(...part.params);
    } else {
      andGroup.push(part.sql);
      allParams.push(...part.params);
    }
  }
  flushAnd();

  const combined = groups.join(" OR ");
  return { sql: groups.length === 1 ? groups[0] : `(${combined})`, params: allParams };
}

function compileWheres(
  wheres: WhereClause[],
  search?: string,
  searchFields?: string[],
  db?: import("bun:sqlite").Database,
  collection?: string,
): SqlFragment {
  const parts: SqlFragment[] = [];
  const allParams: unknown[] = [];

  if (wheres.length > 0) {
    const whereFrag = compileWheresNoSearch(wheres);
    parts.push(whereFrag);
    allParams.push(...whereFrag.params);
  }

  if (search && collection) {
    const searchFrag = buildSearchClause(collection, search ?? "", searchFields, db);
    if (searchFrag.sql) {
      parts.push(searchFrag);
      allParams.push(...searchFrag.params);
    }
  }

  if (parts.length === 0) return { sql: "", params: [] };
  if (parts.length === 1) return { sql: parts[0].sql, params: allParams };
  return { sql: parts.map((p) => `(${p.sql})`).join(" AND "), params: allParams };
}

function buildSearchClause(
  collection: string,
  term: string,
  searchFields?: string[],
  db?: import("bun:sqlite").Database,
): SqlFragment {
  const ftsTable = `${collection}_fts`;
  const hasFts = db ? ftsTableExists(db, collection) : true;
  if (hasFts) {
    return { sql: `id IN (SELECT rowid FROM ${quoteIdent(ftsTable)} WHERE ${quoteIdent(ftsTable)} MATCH ?)`, params: [term] };
  }
  const fields = searchFields && searchFields.length > 0 ? searchFields : [];
  if (fields.length === 0) return { sql: "1 = 0", params: [] };
  const pattern = `%${term}%`;
  const clauses = fields.map((f) => `${quoteIdent(f)} LIKE ?`);
  return { sql: `(${clauses.join(" OR ")})`, params: fields.map(() => pattern) };
}

function ftsTableExists(db: import("bun:sqlite").Database, collection: string): boolean {
  const row = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(`${collection}_fts`) as { 1?: number } | null;
  return row !== null;
}

function regexToLike(pattern: string): string {
  let result = pattern;
  if (result.startsWith("^")) result = result.slice(1);
  if (result.endsWith("$")) result = result.slice(0, -1);
  result = result.replace(/\.\*/g, "%");
  result = result.replace(/\./g, "_");
  return result;
}

function buildJoinClause(join: JoinClause): string {
  const target = quoteIdent(join.target);
  switch (join.type) {
    case "inner":
      return `INNER JOIN ${target}`;
    case "left":
      return `LEFT JOIN ${target}`;
    case "cross":
      return `CROSS JOIN ${target}`;
    default:
      throw new Error(`Unknown join type: ${(join as JoinClause).type}`);
  }
}

function compileJoinOn(join: JoinClause): string {
  if (!join.on || join.on.length === 0) return "";
  const parts = join.on.map((c) => {
    const left = c.left.includes(".") ? c.left.split(".").map(quoteIdent).join(".") : quoteIdent(c.left);
    const right = c.right.includes(".") ? c.right.split(".").map(quoteIdent).join(".") : quoteIdent(c.right);
    return `${left} ${c.operator} ${right}`;
  });
  return ` ON ${parts.join(" AND ")}`;
}

export interface GeneratedQuery {
  sql: string;
  bindings: unknown[];
}

export function generateSQL(state: BuilderState, db?: import("bun:sqlite").Database): GeneratedQuery {
  const bindings: unknown[] = [];
  const parts: string[] = [];

  // CTEs
  const cteDepth = countCTEDepth(state);
  if (cteDepth > CTE_MAX_DEPTH) {
    throw new Error(`CTE nesting depth exceeds maximum of ${CTE_MAX_DEPTH}`);
  }

  let ctePrefix = "";
  if (state.withs.length > 0) {
    const ctes = state.withs.map((w) => {
      const inner = generateSQL(toFullState(w.query), db);
      const cols = w.columns && w.columns.length > 0 ? `(${w.columns.map(quoteIdent).join(", ")})` : "";
      return `${quoteIdent(w.alias)}${cols} AS (${inner.sql})`;
    });
    ctePrefix = `WITH ${ctes.join(", ")} `;
  }

  // SELECT clause
  const isAggregate = (state.aggregate && state.aggregate.length > 0) || (state.groupBy && state.groupBy.length > 0);

  if (isAggregate && state.aggregate) {
    const selectCols = state.aggregate.map((a) => {
      const fn = a.function.startsWith("$") ? a.function.slice(1).toUpperCase() : a.function.toUpperCase();
      if (a.function === "$count" && (!a.field || a.field === "*")) {
        return a.alias ? `COUNT(*) AS ${quoteIdent(a.alias)}` : "COUNT(*)";
      }
      const target = a.field ? quoteIdent(a.field) : "*";
      return a.alias ? `${fn}(${target}) AS ${quoteIdent(a.alias)}` : `${fn}(${target})`;
    });
    parts.push(`SELECT ${selectCols.join(", ")}`);
  } else if (state.fields && state.fields.length > 0) {
    const quoted = state.fields.map((f) => {
      if (f.includes(".")) {
        return `json_extract(${quoteIdent(f.split(".")[0])}, '$.${f.split(".").slice(1).join(".")}') AS ${quoteIdent(f.replace(".", "_"))}`;
      }
      return quoteIdent(f);
    });
    parts.push(`SELECT ${quoted.join(", ")}`);
  } else {
    parts.push("SELECT *");
  }

  if (state.groupBy && state.groupBy.length > 0) {
    for (const g of state.groupBy) {
      parts[0] += `, ${quoteIdent(g)}`;
    }
  }

  // FROM
  if (state.collection) {
    parts.push(`FROM ${quoteIdent(state.collection)}`);
  }

  // JOINs
  for (const join of state.joins) {
    const joinSql = buildJoinClause(join) + compileJoinOn(join);
    parts.push(joinSql);
  }

  // WHERE
  const search = state.search;
  const searchFields = state.searchFields;
  const whereFrag = compileWheres(state.wheres, search, searchFields, db, state.collection);
  if (whereFrag.sql) {
    parts.push(`WHERE ${whereFrag.sql}`);
    bindings.push(...whereFrag.params);
  }

  // GROUP BY
  if (state.groupBy && state.groupBy.length > 0) {
    parts.push(`GROUP BY ${state.groupBy.map(quoteIdent).join(", ")}`);
  }

  // HAVING
  if (state.having && state.having.length > 0) {
    const havingFrag = compileWheresNoSearch(state.having);
    if (havingFrag.sql && havingFrag.sql !== "1 = 1") {
      parts.push(`HAVING ${havingFrag.sql}`);
      bindings.push(...havingFrag.params);
    }
  }

  // ORDER BY
  if (!isAggregate && state.orders.length > 0) {
    const orderParts = state.orders.map((o: OrderClause) => {
      return `${quoteIdent(o.field)} ${o.direction === "desc" ? "DESC" : "ASC"}`;
    });
    parts.push(`ORDER BY ${orderParts.join(", ")}`);
  }

  // LIMIT / OFFSET
  if (!isAggregate) {
    if (state.limit != null) {
      parts.push("LIMIT ?");
      bindings.push(state.limit);
    }
    if (state.offset != null) {
      parts.push("OFFSET ?");
      bindings.push(state.offset);
    }
  }

  let sql = parts.join(" ");

  // Set operations
  for (const u of state.unions) {
    const inner = generateSQL(toFullState(u.query), db);
    const op = {
      union: "UNION",
      unionAll: "UNION ALL",
      intersect: "INTERSECT",
      except: "EXCEPT",
    }[u.type];
    sql += ` ${op} ${inner.sql}`;
    bindings.push(...inner.bindings);
  }

  return { sql: ctePrefix + sql, bindings };
}

function countCTEDepth(state: BuilderState): number {
  let depth = 0;
  for (const w of state.withs) {
    depth = Math.max(depth, 1 + countCTEDepth(toFullState(w.query)));
  }
  return depth;
}
