import { QueryBuilder } from "@boltstore/utils";
import { generateSQL, compileWheresNoSearch } from "./sql-generator";
import type { RLSResult } from "../rls";
import { toBindings } from "../db/cast";
import type { QueryResult } from "./types";

export class ServerQueryBuilder extends QueryBuilder {
  private db: import("bun:sqlite").Database;

  constructor(db: import("bun:sqlite").Database, state?: import("@boltstore/utils").BuilderState) {
    super(state);
    this.db = db;
  }

  clone(): ServerQueryBuilder {
    return new ServerQueryBuilder(this.db, this.cloneState(this.state));
  }

  toSQL(): { sql: string; bindings: unknown[] } {
    return generateSQL(this.state, this.db);
  }

  get<T = Record<string, unknown>>(): T[] {
    const { sql, bindings } = this.toSQL();
    return this.db.query(sql).all(...toBindings(bindings)) as T[];
  }

  first<T = Record<string, unknown>>(): T | null {
    this.limit(1);
    const data = this.get<T>();
    return data[0] ?? null;
  }

  countTotal(): number {
    const collection = this.state.collection;
    if (!collection) throw new Error("Collection name required for countTotal");

    const bindings: unknown[] = [];
    const conditions: string[] = [];

    if (this.state.wheres.length > 0) {
      const where = compileWheresNoSearch(this.state.wheres);
      if (where.sql && where.sql !== "1 = 1") {
        conditions.push(`(${where.sql})`);
        bindings.push(...where.params);
      }
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT COUNT(*) as cnt FROM "${collection}"${whereClause}`;
    const row = this.db.query(sql).get(...toBindings(bindings)) as { cnt?: number } | null;
    return row?.cnt ?? 0;
  }

  applyRLS(rls: RLSResult | null): this {
    if (!rls?.whereClause) return this;
    this.state.wheres.unshift({
      type: "raw",
      sql: rls.whereClause,
      bindings: rls.params as unknown[],
      boolean: "and",
    });
    return this;
  }

  paginate<T>(page: number, perPage: number): QueryResult<T> {
    this.limit(perPage).offset((page - 1) * perPage);
    const data = this.get<T>();
    const total = this.countTotal();
    return {
      data,
      meta: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage) || 1,
      },
    };
  }
}
