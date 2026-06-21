import type { QueryOptions, Filter, FilterGroup, FilterCondition } from "@boltstore/utils";
import { validateIdentifier } from "@boltstore/utils";
import { ServerQueryBuilder } from "./server-builder";
import type { WhereClause } from "@boltstore/utils";

const WHERE_NESTING_MAX = 10;

/**
 * Parse a wire-format Filter back into WhereClause[].
 * This is the inverse of compileFilter() in @boltstore/utils.
 */
function parseFilter(filter: Filter, depth = 0): WhereClause[] {
  if (depth > WHERE_NESTING_MAX) {
    throw new Error("Filter nesting exceeds maximum depth of 10");
  }

  if (!filter || typeof filter !== "object") return [];

  const result: WhereClause[] = [];

  // Logical groups
  const fg = filter as FilterGroup;
  if (fg.$and && Array.isArray(fg.$and)) {
    for (const sub of fg.$and) {
      result.push(...parseFilter(sub, depth + 1));
    }
    return result; // $and children are all implicitly AND'd
  }

  if (fg.$or && Array.isArray(fg.$or)) {
    const orClauses: WhereClause[] = [];
    for (const sub of fg.$or) {
      const subClauses = parseFilter(sub, depth + 1);
      if (subClauses.length === 1) {
        subClauses[0].boolean = "or";
        orClauses.push(subClauses[0]);
      } else if (subClauses.length > 1) {
        orClauses.push({ type: "nested", query: subClauses, boolean: "or" });
      }
    }
    if (orClauses.length > 0) {
      result.push({ type: "nested", query: orClauses, boolean: "and" });
    }
    return result;
  }

  if (fg.$not) {
    const inner = parseFilter(fg.$not, depth + 1);
    result.push({ type: "not", query: inner, boolean: "and" });
    return result;
  }

  // Subquery exists / not exists at filter group level
  const existsSub = (filter as Record<string, unknown>)["$subqueryExists"];
  if (existsSub && typeof existsSub === "object" && existsSub !== null) {
    const es = existsSub as { collection: string; filter?: import("@boltstore/utils").Filter };
    validateIdentifier(es.collection, "subquery collection");
    const inner = es.filter ? parseFilter(es.filter, depth + 1) : [];
    result.push({ type: "exists", field: "", operator: "exists", subqueryCollection: es.collection, subqueryFilter: inner, boolean: "and" });
    return result;
  }
  const notExistsSub = (filter as Record<string, unknown>)["$subqueryNotExists"];
  if (notExistsSub && typeof notExistsSub === "object" && notExistsSub !== null) {
    const nes = notExistsSub as { collection: string; filter?: import("@boltstore/utils").Filter };
    validateIdentifier(nes.collection, "subquery collection");
    const inner = nes.filter ? parseFilter(nes.filter, depth + 1) : [];
    result.push({ type: "exists", field: "", operator: "notExists", subqueryCollection: nes.collection, subqueryFilter: inner, boolean: "and" });
    return result;
  }

  // Raw SQL passthrough (debug only, by checking for $raw)
  const raw = (filter as Record<string, unknown>)["$raw"];
  if (raw && typeof raw === "object" && raw !== null) {
    const r = raw as { sql: string; bindings?: unknown[] };
    result.push({ type: "raw", sql: r.sql, bindings: r.bindings ?? [], boolean: "and" });
    return result;
  }

  // Field conditions
  for (const [field, value] of Object.entries(filter)) {
    if (field.startsWith("$")) continue; // skip $raw, $and, $or, $not (already handled)

    // Allow dotted paths for JSON fields: "tags.color" → validate "tags"
    const fieldRoot = field.includes(".") ? field.split(".")[0] : field;
    validateIdentifier(fieldRoot, "filter field");
    const fc = filter as FilterCondition;

    if (value === null) {
      result.push({ type: "null", field, operator: "null", boolean: "and" });
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Operator syntax: { field: { $gt: 5 } }
      const ops = value as Record<string, unknown>;
      for (const [op, val] of Object.entries(ops)) {
        const clause = parseOperatorClause(field, op, val);
        if (clause) result.push(clause);
      }
    } else {
      // Shorthand equality: { field: value }
      result.push({ type: "basic", field, operator: "eq", value, boolean: "and" });
    }
  }

  return result;
}

const OP_TO_CLAUSE: Record<string, { type: WhereClause["type"]; operator: string }> = {
  $eq: { type: "basic", operator: "eq" },
  $neq: { type: "basic", operator: "neq" },
  $gt: { type: "basic", operator: "gt" },
  $gte: { type: "basic", operator: "gte" },
  $lt: { type: "basic", operator: "lt" },
  $lte: { type: "basic", operator: "lte" },
  $contains: { type: "basic", operator: "contains" },
  $startsWith: { type: "basic", operator: "startsWith" },
  $endsWith: { type: "basic", operator: "endsWith" },
  $regexp: { type: "basic", operator: "regexp" },
  $in: { type: "in", operator: "in" },
  $nin: { type: "in", operator: "notIn" },
  $exists: { type: "exists", operator: "exists" },
  $like: { type: "like", operator: "like" },
  $glob: { type: "like", operator: "glob" },
  $between: { type: "between", operator: "between" },
  $notBetween: { type: "between", operator: "notBetween" },
};

function parseOperatorClause(field: string, op: string, value: unknown): WhereClause | null {
  // Field-level $not: { field: { $not: { $eq: val } } }
  if (op === "$not") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 1) {
        const [innerOp, innerVal] = entries[0];
        const inner = parseOperatorClause(field, innerOp, innerVal);
        if (inner) {
          return { type: "not", query: [inner], boolean: "and" };
        }
      }
    }
    throw new Error("Invalid field-level $not syntax. Expected { field: { $not: { $eq: val } } }");
  }

  const mapping = OP_TO_CLAUSE[op];
  if (!mapping) throw new Error(`Unknown filter operator "${op}"`);

  if (op === "$exists") {
    return { type: "exists", field, operator: value ? "exists" : "notExists", boolean: "and" };
  }

  if (op === "$neq" && value === null) {
    return { type: "null", field, operator: "notNull", boolean: "and" };
  }

  switch (mapping.type) {
    case "basic":
      return { type: "basic", field, operator: mapping.operator as any, value, boolean: "and" };
    case "in":
      return { type: "in", field, operator: mapping.operator as "in" | "notIn", value: value as unknown[], boolean: "and" };
    case "null":
      return { type: "null", field, operator: "null", boolean: "and" };
    case "between":
      return { type: "between", field, operator: mapping.operator as "between" | "notBetween", value: value as [unknown, unknown], boolean: "and" };
    case "like":
      return { type: "like", field, operator: mapping.operator as "like" | "glob", value: value as string, boolean: "and" };
    case "exists":
      return { type: "exists", field, operator: value ? "exists" : "notExists", boolean: "and" };
    default:
      return null;
  }
}

export function queryFromParams(params: QueryOptions, db: import("bun:sqlite").Database): ServerQueryBuilder {
  const qb = new ServerQueryBuilder(db);

  if (!params.collection) throw new Error("Field 'collection' is required.");
  validateIdentifier(params.collection, "collection name");
  qb.from(params.collection);

  if (params.filter) {
    const wheres = parseFilter(params.filter);
    qb.state.wheres.push(...wheres);
  }

  if (params.sort && params.sort.length > 0) {
    for (const s of params.sort) {
      validateIdentifier(s.field, "sort field");
      qb.orderBy(s.field, s.direction);
    }
  }

  if (params.fields && params.fields.length > 0) {
    for (const f of params.fields) {
      validateIdentifier(f.replace(/\..*$/, ""), "select field");
    }
    qb.select(...params.fields);
  }

  if (params.expand && params.expand.length > 0) {
    qb.expand(...params.expand);
  }

  if (params.limit != null) qb.limit(params.limit);
  if (params.offset != null) qb.offset(params.offset);

  if (params.search) qb.search(params.search, params.searchFields);

  if ((params as any).windows) {
    qb.window((params as any).windows);
  }

  if (params.aggregate) {
    qb.aggregate(params.aggregate);
  } else if ((params as any).multiAggregate) {
    qb.aggregate((params as any).multiAggregate);
  }

  if (params.groupBy) {
    const groups = Array.isArray(params.groupBy) ? params.groupBy : [params.groupBy];
    qb.groupBy(...groups);
  }

  if (params.having) {
    const havingClauses = parseFilter(params.having);
    qb.state.having = havingClauses;
  }

  // CTEs — structured format, validated carefully
  const withs = (params as any).withs;
  if (withs && Array.isArray(withs)) {
    qb.state.withs = withs.map((w: any) => ({
      alias: String(w.alias),
      columns: w.columns ? w.columns.map(String) : undefined,
      query: {
        collection: w.query?.collection ? String(w.query.collection) : undefined,
        wheres: w.query?.wheres || [],
        orders: w.query?.orders || [],
        limit: w.query?.limit,
        offset: w.query?.offset,
      },
    }));
  }

  // Set operations
  const unions = (params as any).unions;
  if (unions && Array.isArray(unions)) {
    qb.state.unions = unions.map((u: any) => ({
      type: u.type,
      query: {
        collection: u.query?.collection,
        wheres: u.query?.wheres || [],
        orders: u.query?.orders || [],
        limit: u.query?.limit,
        offset: u.query?.offset,
      },
    }));
  }

  // Joins — structured, reject raw SQL
  const joins = (params as any).joins;
  if (joins && Array.isArray(joins)) {
    for (const j of joins) {
      validateIdentifier(j.target, "join target");
      if (j.on) {
        if (typeof j.on === "string") {
          throw new Error("Raw SQL strings in join 'on' are not allowed. Use structured { left, operator, right }.");
        }
        if (!Array.isArray(j.on)) {
          throw new Error("Join 'on' must be an array.");
        }
        for (const c of j.on) {
          if (typeof c.left !== "string" || typeof c.right !== "string") {
            throw new Error("Join 'on' conditions must have string 'left' and 'right' fields.");
          }
          validateIdentifier(c.left.replace(/\..*$/, ""), "join on left");
          validateIdentifier(c.right.replace(/\..*$/, ""), "join on right");
        }
      }
      qb.state.joins.push({
        type: j.type || "inner",
        target: j.target,
        on: j.on?.map((c: any) => ({
          left: c.left,
          operator: c.operator || "=",
          right: c.right,
        })),
      });
    }
  }

  return qb;
}
