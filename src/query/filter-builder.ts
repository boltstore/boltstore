import { FilterOperator, FilterExpression, LogicalGroup, SqlFragment } from "./types";
import { validateIdentifier } from "@boltstore/utils";

export function buildWhere(filter: FilterExpression | FilterExpression[]): SqlFragment {
  const filters = Array.isArray(filter) ? filter : [filter];
  const parts = filters.map(buildFilterExpression);
  const sql = parts.map((p) => `(${p.sql})`).join(" AND ");
  const params = parts.flatMap((p) => p.params);
  return { sql, params };
}

export function buildFilterExpression(expr: FilterExpression): SqlFragment {
  const keys = Object.keys(expr);

  if (keys.some((k) => k === "$and" || k === "$or" || k === "$not")) {
    return buildLogicalGroup(expr as LogicalGroup);
  }

  const fragments: SqlFragment[] = [];
  for (const field of keys) {
    const value = (expr as Record<string, unknown>)[field];

    const sqlField = field.includes(".")
      ? `json_extract("${field.split(".")[0]}", '$.${field.split(".").slice(1).join(".")}')`
      : validateAndQuote(field);

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [op, val] of Object.entries(value as Record<string, unknown>)) {
        const frag = buildOperator(sqlField, op as FilterOperator, val);
        fragments.push(frag);
      }
    } else {
      fragments.push({ sql: `${sqlField} = ?`, params: [value] });
    }
  }

  return {
    sql: fragments.map((f) => f.sql).join(" AND "),
    params: fragments.flatMap((f) => f.params),
  };
}

export function buildLogicalGroup(group: LogicalGroup): SqlFragment {
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

export function buildOperator(field: string, op: FilterOperator, value: unknown): SqlFragment {
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
        return { sql: "1 = 0", params: [] };
      }
      const placeholders = value.map(() => "?").join(", ");
      return { sql: `${field} IN (${placeholders})`, params: value };
    }
    case "$nin": {
      if (!Array.isArray(value) || value.length === 0) {
        return { sql: "1 = 1", params: [] };
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
      return { sql: `${field} LIKE ?`, params: [regexToLike(String(value))] };
    default:
      throw Object.assign(
        new Error(`Unknown filter operator "${op}".`),
        { status: 400 }
      );
  }
}

export function regexToLike(pattern: string): string {
  let result = pattern;
  if (result.startsWith("^")) result = result.slice(1);
  if (result.endsWith("$")) result = result.slice(0, -1);
  result = result.replace(/\.\*/g, "%");
  result = result.replace(/\./g, "_");
  return result;
}

export function validateAndQuote(name: string): string {
  validateIdentifier(name, "column/field name");
  return `"${name}"`;
}
