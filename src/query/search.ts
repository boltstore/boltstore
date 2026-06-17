import { SqlFragment } from "./types";
import { validateAndQuote } from "./filter-builder";

export function ftsTableExists(db: import("bun:sqlite").Database, collection: string): boolean {
  const row = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(`${collection}_fts`) as { 1?: number } | null;
  return row !== null;
}

export function buildSearchClause(
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

  const fields = searchFields && searchFields.length > 0 ? searchFields : [];
  if (fields.length === 0) {
    return { sql: "1 = 0", params: [] };
  }

  const pattern = `%${term}%`;
  const clauses = fields.map((f) => `${validateAndQuote(f)} LIKE ?`);
  return {
    sql: `(${clauses.join(" OR ")})`,
    params: fields.map(() => pattern),
  };
}
