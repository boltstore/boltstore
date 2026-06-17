import { QueryParams, QueryResult } from "./types";
import { buildQuery } from "./builder";
import { buildWhere } from "./filter-builder";
import { buildSearchClause } from "./search";
import { toBindings } from "../db/cast";

export function executeQuery(
  db: import("bun:sqlite").Database,
  collection: string,
  params: QueryParams,
  page?: number,
  perPage?: number
): QueryResult {
  const isAggregate =
    params.aggregate !== undefined || params.groupBy !== undefined;

  if (page !== undefined && perPage !== undefined && !params.cursor) {
    params.limit = perPage;
    params.offset = (page - 1) * perPage;
  }

  const { sql, bindings } = buildQuery(collection, params, db);

  const data = db.query(sql).all(...toBindings(bindings)) as Record<string, unknown>[];

  if (isAggregate) {
    return { data, meta: {} };
  }

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

function countTotal(
  db: import("bun:sqlite").Database,
  collection: string,
  params: QueryParams
): number {
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
