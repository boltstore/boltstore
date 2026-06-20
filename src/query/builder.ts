import { QueryParams } from "./types";
import { buildWhere, buildFilterExpression, validateAndQuote } from "./filter-builder";
import { buildSearchClause } from "./search";
import { validateIdentifier } from "@boltstore/utils";
import type { RLSResult } from "../rls";

export function buildQuery(
  collection: string,
  params: QueryParams,
  db?: import("bun:sqlite").Database,
  rls?: RLSResult | null
): { sql: string; bindings: unknown[] } {
  validateIdentifier(collection, "collection name");

  let sql = "";
  const bindings: unknown[] = [];
  const isAggregate =
    params.aggregate !== undefined || params.groupBy !== undefined;

  // --- SELECT clause ---

  if (isAggregate && params.aggregate) {
    const agg = params.aggregate;
    const fn = agg.function.startsWith("$") ? agg.function.slice(1).toUpperCase() : agg.function.toUpperCase();
    if (agg.function === "$count" && (!agg.field || agg.field === "*")) {
      sql += `SELECT COUNT(*)`;
    } else {
      const target = agg.field ? validateAndQuote(agg.field) : "*";
      sql += `SELECT ${fn}(${target})`;
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
    const groups = Array.isArray(params.groupBy) ? params.groupBy : [params.groupBy];
    for (const g of groups) {
      sql += `, "${g}"`;
    }
  }

  sql += ` FROM "${collection}"`;

  // --- WHERE clause ---

  const conditions: string[] = [];

  if (rls?.whereClause) {
    conditions.push(rls.whereClause);
    bindings.push(...rls.params);
  }

  if (params.search) {
    const ftsFragment = buildSearchClause(collection, params.search, params.searchFields, db);
    if (ftsFragment.sql) {
      conditions.push(ftsFragment.sql);
      bindings.push(...ftsFragment.params);
    }
  } else if (params.filter) {
    const where = buildWhere(params.filter);
    if (where.sql) {
      conditions.push(where.sql);
      bindings.push(...where.params);
    }
  }

  if (!isAggregate && params.cursor) {
    const cursorSortField = params.sort && params.sort.length > 0 ? params.sort[0].split(":")[0] : "created_at";
    validateIdentifier(cursorSortField, "cursor sort field");
    conditions.push(`"${cursorSortField}" > ?`);
    bindings.push(params.cursor);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  // --- GROUP BY ---

  if (params.groupBy) {
    const groups = Array.isArray(params.groupBy) ? params.groupBy : [params.groupBy];
    sql += ` GROUP BY ${groups.map((g: string) => `"${g}"`).join(", ")}`;
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
