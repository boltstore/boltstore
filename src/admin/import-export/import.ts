import { DatabasePool } from "../../db/pool";
import { toBindings } from "../../db/cast";
import { validateIdentifier, type ColumnDefinition, type ColumnType } from "@boltstore/utils";
import { createCollection } from "../../collections";
import { parseCSV, coerceCSVValue } from "./csv";
import { parseJSONInput } from "./json-input";
import { inferSchema } from "./schema-inference";
import { ImportOptions, ImportResult, SYSTEM_COLUMNS } from "./types";

function getColumnTypes(pool: DatabasePool, collection: string): { columns: string[]; types: Map<string, string> } {
  const db = pool.read();

  const tableRows = db
    .query(`PRAGMA table_info("${collection}")`)
    .all() as { name: string; type: string }[];

  const columns = tableRows.map((r) => r.name);

  const metaRow = db
    .query("SELECT schema_json FROM _collections WHERE name=?")
    .get(collection) as { schema_json?: string } | null;

  const types = new Map<string, string>();
  if (metaRow?.schema_json) {
    try {
      const parsed = JSON.parse(metaRow.schema_json) as { name: string; type: string }[];
      for (const col of parsed) {
        types.set(col.name, col.type.toUpperCase());
      }
      for (const row of tableRows) {
        if (!types.has(row.name)) {
          types.set(row.name, row.type.toUpperCase());
        }
      }
      return { columns, types };
    } catch {
    }
  }

  for (const row of tableRows) {
    types.set(row.name, row.type.toUpperCase());
  }

  return { columns, types };
}

function validateRecord(
  record: Record<string, unknown>,
  columns: string[],
  columnTypes: Map<string, string>
): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (SYSTEM_COLUMNS.has(key)) continue;

    if (!columns.includes(key)) {
      return `Unknown column "${key}". Valid columns: ${columns.join(", ")}`;
    }

    const expectedType = columnTypes.get(key);
    if (expectedType && value !== null && value !== undefined) {
      const jsType = typeof value;
      if (expectedType === "INTEGER") {
        if (jsType !== "number" || !Number.isInteger(value)) {
          return `Column "${key}" expects INTEGER, got ${jsType} (${JSON.stringify(value)}).`;
        }
      } else if (expectedType === "REAL") {
        if (jsType !== "number") {
          return `Column "${key}" expects REAL/INTEGER, got ${jsType} (${JSON.stringify(value)}).`;
        }
      } else if (expectedType === "BOOLEAN") {
        if (jsType !== "boolean") {
          return `Column "${key}" expects BOOLEAN, got ${jsType} (${JSON.stringify(value)}).`;
        }
      }
    }
  }

  return null;
}

function generateImportId(): string {
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  return `imp_${Date.now().toString(36)}_${Buffer.from(random).toString("base64url")}`;
}

export function importData(
  pool: DatabasePool,
  collection: string,
  input: string,
  options: ImportOptions = {}
): ImportResult {
  validateIdentifier(collection, "collection name");

  const format = options.format ?? "json";
  const autoCreate = options.autoCreate ?? false;
  const dryRun = options.dryRun ?? false;
  const hasHeader = options.hasHeader ?? true;

  let records: Record<string, unknown>[];

  if (format === "csv") {
    const rows = parseCSV(input);

    if (rows.length === 0) {
      return { imported: 0, failed: 0, errors: [], dryRun };
    }

    if (hasHeader) {
      const headers = rows[0];
      const dataRows = rows.slice(1);

      for (const h of headers) {
        if (!h || h.trim() === "") {
          throw Object.assign(
            new Error("CSV header contains empty column name."),
            { status: 400 }
          );
        }
      }

      if (dataRows.length === 0) {
        if (autoCreate && !dryRun) {
          const db = pool.read();
          const exists = db
            .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
            .get(collection) !== null;
          if (!exists) {
            const schema = headers.map((h) => ({ name: h, type: "TEXT" as const }));
            const created = createCollection(pool, collection, schema);
            return {
              imported: 0,
              failed: 0,
              dryRun,
              collection: { name: created.name, columns: created.columns },
            };
          }
        }
        return { imported: 0, failed: 0, errors: [], dryRun };
      }

      records = dataRows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i];
          const rawValue = i < row.length ? row[i] : "";
          obj[header] = coerceCSVValue(rawValue);
        }
        return obj;
      });
    } else {
      const maxCols = Math.max(...rows.map((r) => r.length));
      records = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < maxCols; i++) {
          const rawValue = i < row.length ? row[i] : "";
          obj[`col_${i}`] = coerceCSVValue(rawValue);
        }
        return obj;
      });
    }
  } else {
    records = parseJSONInput(input);
  }

  if (options.maxRows !== undefined && records.length > options.maxRows) {
    throw Object.assign(
      new Error(`Import data exceeds maximum of ${options.maxRows} rows.`),
      { status: 413 }
    );
  }

  if (records.length === 0) {
    return { imported: 0, failed: 0, errors: [], dryRun };
  }

  const db = pool.read();
  let collectionExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(collection) !== null;

  let collectionResult: { name: string; columns: unknown[] } | undefined;

  if (!collectionExists) {
    if (autoCreate) {
      const schema = inferSchema(records);
      if (schema.length === 0) {
        throw Object.assign(
          new Error("Cannot auto-create collection: no columns could be inferred from the data."),
          { status: 400 }
        );
      }

      if (dryRun) {
        return {
          imported: 0,
          failed: 0,
          dryRun: true,
          collection: { name: collection, columns: schema },
        };
      }

      const typedSchema: ColumnDefinition[] = schema.map((s) => ({
        name: s.name,
        type: s.type as ColumnType,
      }));
      const created = createCollection(pool, collection, typedSchema);
      collectionResult = { name: created.name, columns: created.columns };
      collectionExists = true;
    } else {
      throw Object.assign(
        new Error(`Collection "${collection}" not found. Set autoCreate: true to create it automatically.`),
        { status: 404 }
      );
    }
  }

  const { columns, types: columnTypes } = getColumnTypes(pool, collection);

  const errors: { row: number; message: string }[] = [];
  const validRecords: Record<string, unknown>[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const validationError = validateRecord(record, columns, columnTypes);
    if (validationError) {
      errors.push({ row: i, message: validationError });
    } else {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) {
        if (!SYSTEM_COLUMNS.has(k)) {
          clean[k] = v;
        }
      }
      if ("id" in record) clean.id = record.id;
      if ("created_at" in record) clean.created_at = record.created_at;
      validRecords.push(clean);
    }
  }

  if (validRecords.length === 0 && errors.length > 0) {
    return { imported: 0, failed: errors.length, errors, dryRun };
  }

  if (dryRun) {
    return {
      imported: 0,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      dryRun: true,
    };
  }

  let imported = 0;

  pool.writeTransaction(() => {
    const writeDb = pool.write();

    const userCols = new Set<string>();
    for (const record of validRecords) {
      for (const k of Object.keys(record)) {
        if (k !== "id" && k !== "created_at" && k !== "updated_at") {
          userCols.add(k);
        }
      }
    }
    const insertColumns = ["id", "created_at", "updated_at", ...userCols];
    const colPlaceholders = insertColumns.map(() => "?").join(", ");
    const colNames = insertColumns.map((k) => `"${k}"`).join(", ");
    const insertStmt = writeDb.query(
      `INSERT INTO "${collection}" (${colNames}) VALUES (${colPlaceholders})`
    );

    for (const record of validRecords) {
      const id = (record.id as string) || generateImportId();
      const timestamp = new Date().toISOString();

      const finalRecord: Record<string, unknown> = {
        id,
        created_at: (record.created_at as string) || timestamp,
        updated_at: timestamp,
      };

      for (const col of userCols) {
        if (col in record) {
          finalRecord[col] = record[col];
        } else {
          finalRecord[col] = null;
        }
      }

      const values = insertColumns.map((k) => finalRecord[k]);
      insertStmt.run(...toBindings(values));
      imported++;
    }

    insertStmt.finalize();
  });

  return {
    imported,
    failed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
    dryRun,
    collection: collectionResult,
  };
}