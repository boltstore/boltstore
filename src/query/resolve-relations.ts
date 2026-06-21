import type { BuilderState, WithRelation } from "@boltstore/utils";
import { Database } from "bun:sqlite";
import { toBindings } from "../db/cast";

function collectFKValues(rows: Record<string, unknown>[], field: string): unknown[] {
  const vals = new Set<unknown>();
  for (const row of rows) {
    const v = row[field];
    if (v != null) vals.add(v);
  }
  return [...vals];
}

function buildWhereClause(field: string, values: unknown[]): string {
  const phs = values.map(() => "?").join(", ");
  return `"${field}" IN (${phs})`;
}

export function resolveRelations(
  state: BuilderState,
  db: Database,
  data: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (!state.with || Object.keys(state.with).length === 0) return data;
  return resolveNestedRelations(state.with, state.collection!, db, data);
}

function resolveNestedRelations(
  relations: Record<string, WithRelation>,
  parentCollection: string,
  db: Database,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  for (const [alias, def] of Object.entries(relations)) {
    const collection = def.collection || alias;
    const localKey = def.localKey || `${alias}_id`;
    const foreignKey = def.foreignKey || "id";

    const fkValues = collectFKValues(rows, localKey);

    if (fkValues.length === 0) {
      for (const row of rows) {
        row[alias] = def.multiple ? [] : null;
      }
      continue;
    }

    let sql = `SELECT * FROM "${collection}" WHERE ${buildWhereClause(foreignKey, fkValues)}`;
    const bindings: unknown[] = [...fkValues];

    if (def.filter && typeof def.filter === "object") {
      for (const [field, val] of Object.entries(def.filter)) {
        if (field.startsWith("$")) continue;
        sql += ` AND "${field}" = ?`;
        bindings.push(val);
      }
    }

    if (def.fields && def.fields.length > 0) {
      const allFields = def.fields.includes(foreignKey) ? def.fields : [foreignKey, ...def.fields];
      const quoted = allFields.map((f) => `"${f}"`).join(", ");
      sql = `SELECT ${quoted} FROM "${collection}" WHERE ${buildWhereClause(foreignKey, fkValues)}`;
    }

    if (def.sort && def.sort.length > 0) {
      const orderParts = def.sort.map((s: any) => `"${s.field}" ${s.direction === "desc" ? "DESC" : "ASC"}`);
      sql += ` ORDER BY ${orderParts.join(", ")}`;
    }

    if (def.limit != null) {
      sql += ` LIMIT ?`;
      bindings.push(def.limit);
    }
    if (def.offset != null) {
      sql += ` OFFSET ?`;
      bindings.push(def.offset);
    }

    const relatedRows = db.query(sql).all(...toBindings(bindings)) as Record<string, unknown>[];

    const index = new Map<unknown, Record<string, unknown>[]>();
    for (const rr of relatedRows) {
      const fk = rr[foreignKey];
      if (!index.has(fk)) index.set(fk, []);
      index.get(fk)!.push(rr);
    }

    for (const row of rows) {
      const fk = row[localKey];
      const related = index.get(fk) || [];
      if (fk == null || related.length === 0) {
        row[alias] = def.multiple ? [] : null;
      } else if (def.multiple) {
        row[alias] = related;
      } else {
        row[alias] = related[0];
      }
    }

    if (def.with) {
      const allRelated = rows.flatMap((r) => {
        const val = r[alias];
        if (Array.isArray(val)) return val;
        if (val && typeof val === "object") return [val as Record<string, unknown>];
        return [];
      });
      if (allRelated.length > 0) {
        resolveNestedRelations(def.with as Record<string, WithRelation>, collection, db, allRelated);
      }
    }
  }

  return rows;
}
