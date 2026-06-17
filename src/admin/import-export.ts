/**
 * Import / Export module for Boltstore collections.
 *
 * Supports importing CSV or JSON data into a collection, and exporting
 * collection records to CSV or JSON format. Schema auto-detection is
 * available when importing into a new collection.
 *
 * All import operations run inside a single transaction for atomicity.
 *
 * @module boltstore/admin/import-export
 */

import { DatabasePool } from "../db/pool";
import { toBindings } from "../db/cast";
import { validateIdentifier, type ColumnDefinition, type ColumnType } from "@boltstore/utils";
import { generateSecureId } from "../auth";
import { createCollection, getCollection } from "../collections";
import { listRecords } from "../records";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Format of the input data. Defaults to auto-detection based on Content-Type or file extension. */
  format?: "csv" | "json";
  /** If true, create the collection if it doesn't exist (auto-detect schema from data). */
  autoCreate?: boolean;
  /** If true, validate the data but don't write any records. Returns validation results. */
  dryRun?: boolean;
  /** Whether the input has a header row (CSV only). Default: true. */
  hasHeader?: boolean;
  /** Maximum number of rows allowed in the import payload. */
  maxRows?: number;
}

export interface ImportResult {
  /** Number of records successfully imported. */
  imported: number;
  /** Number of records that failed validation. */
  failed: number;
  /** Per-row error details (only populated for failed rows). */
  errors?: ImportError[];
  /** Schema info if a new collection was auto-created. */
  collection?: {
    name: string;
    schema: unknown[];
  };
  /** Whether this was a dry run. */
  dryRun: boolean;
}

export interface ImportError {
  /** 0-based row index (or line number for NDJSON). */
  row: number;
  /** Error message describing the failure. */
  message: string;
}

export interface ExportOptions {
  /** Output format. */
  format?: "csv" | "json";
  /** Filter criteria (same as listRecords). */
  filter?: Record<string, unknown>;
  /** Sort field. */
  sort?: string;
  /** Sort direction. */
  direction?: "asc" | "desc";
  /** Specific fields to export. If omitted, all fields are exported (excluding system columns). */
  fields?: string[];
  /** Limit number of records. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
}

export interface ExportResult {
  /** The exported data as a string (CSV) or JSON envelope serialized string. */
  data: string;
  /** Metadata about the export. */
  meta: {
    /** Number of records exported. */
    recordCount: number;
    /** Format of the exported data. */
    format: "csv" | "json";
    /** Collection name. */
    collection: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Columns that are managed by the system and should not be imported directly. */
const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"]);

// ---------------------------------------------------------------------------
// CSV Parser (hand-built, no third-party library)
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string into an array of rows, each row being an array of string values.
 *
 * Handles:
 * - Quoted fields (double-quotes)
 * - Escaped quotes within quoted fields ("" → ")
 * - Commas and newlines inside quoted fields
 * - Windows-style line endings (CRLF)
 * - Empty fields (including trailing empty fields)
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const len = text.length;

  let i = 0;
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("" inside quoted field)
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i += 1;
      } else {
        currentField += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        // Start of quoted field
        if (currentField === "") {
          inQuotes = true;
          i += 1;
        } else {
          // Quote appearing mid-field without preceding delimiter — treat as literal
          currentField += ch;
          i += 1;
        }
      } else if (ch === ",") {
        // End of field
        currentRow.push(currentField);
        currentField = "";
        i += 1;
      } else if (ch === "\r") {
        // CR — could be part of CRLF
        if (i + 1 < len && text[i + 1] === "\n") {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
          i += 2;
        } else {
          // Standalone CR — treat as line ending
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
          i += 1;
        }
      } else if (ch === "\n") {
        // End of row
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i += 1;
      } else {
        currentField += ch;
        i += 1;
      }
    }
  }

  // Don't forget the last field and row
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // If the input was empty, return empty array (not an array with one empty row)
  if (rows.length === 1 && rows[0].length === 1 && rows[0][0] === "") {
    return [];
  }

  return rows;
}

/**
 * Convert a raw CSV value string to an appropriate typed value.
 */
function coerceCSVValue(value: string): unknown {
  // Booleans
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;

  // Null / empty
  if (value === "" || value.toLowerCase() === "null") return null;

  // Try integer
  if (/^-?\d+$/.test(value)) {
    const n = parseInt(value, 10);
    // Only treat as integer if it fits safely
    if (Number.isSafeInteger(n)) return n;
  }

  // Try float
  if (/^-?\d+\.\d+$/.test(value)) {
    const n = parseFloat(value);
    if (!Number.isNaN(n)) return n;
  }

  // Otherwise, keep as string
  return value;
}

// ---------------------------------------------------------------------------
// ColumnType inference (for auto-create)
// ---------------------------------------------------------------------------

/**
 * Infer the SQLite column type from a JavaScript value.
 */
function inferColumnType(value: unknown): string {
  if (value === null || value === undefined) return "TEXT";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return "INTEGER";
    return "REAL";
  }
  return "TEXT";
}

/**
 * Infer column names and types from an array of records.
 * Merges types across all records — the broadest type wins (TEXT > REAL > INTEGER > BOOLEAN).
 */
function inferSchema(records: Record<string, unknown>[]): { name: string; type: string }[] {
  const columnTypeMap = new Map<string, string>();

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const inferred = inferColumnType(value);
      const existing = columnTypeMap.get(key);

      if (!existing) {
        columnTypeMap.set(key, inferred);
      } else if (existing !== inferred) {
        // Upgrade to broader type: TEXT is broadest, REAL > INTEGER > BOOLEAN
        const typeRank: Record<string, number> = { BOOLEAN: 1, INTEGER: 2, REAL: 3, TEXT: 4, BLOB: 5, DATETIME: 5 };
        const currentRank = typeRank[existing] ?? 0;
        const newRank = typeRank[inferred] ?? 0;
        if (newRank > currentRank) {
          columnTypeMap.set(key, inferred);
        }
      }
    }
  }

  return Array.from(columnTypeMap.entries()).map(([name, type]) => ({ name, type }));
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse JSON input, supporting both a JSON array and NDJSON (one object per line).
 */
function parseJSONInput(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();

  // Try parsing as a JSON array
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw Object.assign(
        new Error("JSON input must be an array of objects or NDJSON (one object per line)."),
        { status: 400 }
      );
    }
    for (let i = 0; i < parsed.length; i++) {
      if (typeof parsed[i] !== "object" || parsed[i] === null || Array.isArray(parsed[i])) {
        throw Object.assign(
          new Error(`Row ${i}: Each element must be a JSON object, got ${typeof parsed[i]}.`),
          { status: 400 }
        );
      }
    }
    return parsed as Record<string, unknown>[];
  }

  // Try NDJSON (one object per line) — must start with `{`
  if (trimmed.startsWith("{")) {
    const lines = trimmed.split("\n");
    const records: Record<string, unknown>[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
          throw Object.assign(
            new Error(`Line ${i + 1}: Each line must be a JSON object, got ${typeof obj}.`),
            { status: 400 }
          );
        }
        records.push(obj as Record<string, unknown>);
      } catch (err) {
        if ((err as { status?: number }).status) throw err;
        throw Object.assign(
          new Error(`Line ${i + 1}: Invalid JSON — ${(err as Error).message}`),
          { status: 400 }
        );
      }
    }

    if (records.length === 0) {
      throw Object.assign(
        new Error("JSON input must be an array of objects or NDJSON (one object per line)."),
        { status: 400 }
      );
    }

    return records;
  }

  // Not an array and not an object — invalid
  throw Object.assign(
    new Error("JSON input must be an array of objects or NDJSON (one object per line)."),
    { status: 400 }
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Get column type information for a collection.
 * Reads from _collections metadata schema first (to preserve types like BOOLEAN
 * that SQLite PRAGMA reports as INTEGER), falling back to PRAGMA.
 */
function getColumnTypes(pool: DatabasePool, collection: string): { columns: string[]; types: Map<string, string> } {
  const db = pool.read();

  const tableRows = db
    .query(`PRAGMA table_info("${collection}")`)
    .all() as { name: string; type: string }[];

  const columns = tableRows.map((r) => r.name);

  // Try to get original schema types from _collections metadata
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
      // Fill in any missing columns from PRAGMA (e.g., system columns)
      for (const row of tableRows) {
        if (!types.has(row.name)) {
          types.set(row.name, row.type.toUpperCase());
        }
      }
      return { columns, types };
    } catch {
      // If schema JSON is broken, fall through to PRAGMA types
    }
  }

  // Fall back to PRAGMA types
  for (const row of tableRows) {
    types.set(row.name, row.type.toUpperCase());
  }

  return { columns, types };
}

/**
 * Validate a single record against a collection's existing columns.
 * Returns an error message or null if valid.
 */
function validateRecord(
  record: Record<string, unknown>,
  columns: string[],
  columnTypes: Map<string, string>
): string | null {
  for (const [key, value] of Object.entries(record)) {
    // Skip system columns in validation — they're handled during insert
    if (SYSTEM_COLUMNS.has(key)) continue;

    // Check column exists
    if (!columns.includes(key)) {
      return `Unknown column "${key}". Valid columns: ${columns.join(", ")}`;
    }

    // Type validation
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
      // TEXT and BLOB accept any type (string is the default)
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API — Import
// ---------------------------------------------------------------------------

/**
 * Import data (CSV or JSON) into a collection.
 *
 * If `autoCreate` is true and the collection doesn't exist, it will be created
 * with a schema inferred from the data, then the data is imported.
 *
 * If `dryRun` is true, the data is validated but no changes are written.
 *
 * `POST /api/admin/:database/collections/:collection/import`
 */
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

  // --- Parse input ---
  let records: Record<string, unknown>[];

  if (format === "csv") {
    const rows = parseCSV(input);

    if (rows.length === 0) {
      return { imported: 0, failed: 0, errors: [], dryRun };
    }

    if (hasHeader) {
      const headers = rows[0];
      const dataRows = rows.slice(1);

      // Validate headers
      for (const h of headers) {
        if (!h || h.trim() === "") {
          throw Object.assign(
            new Error("CSV header contains empty column name."),
            { status: 400 }
          );
        }
      }

      if (dataRows.length === 0) {
        // Only headers, no data — can still auto-create collection
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
              collection: { name: created.name, schema: created.schema },
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
      // No header — use 0-based column indices as names
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
    // JSON
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

  // --- Check if collection exists ---
  const db = pool.read();
  let collectionExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(collection) !== null;

  let collectionResult: { name: string; schema: unknown[] } | undefined;

  if (!collectionExists) {
    if (autoCreate) {
      // Auto-detect schema from data
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
          collection: { name: collection, schema },
        };
      }

      const typedSchema: ColumnDefinition[] = schema.map((s) => ({
        name: s.name,
        type: s.type as ColumnType,
      }));
      const created = createCollection(pool, collection, typedSchema);
      collectionResult = { name: created.name, schema: created.schema };
      collectionExists = true; // Collection now exists, proceed with import
    } else {
      throw Object.assign(
        new Error(`Collection "${collection}" not found. Set autoCreate: true to create it automatically.`),
        { status: 404 }
      );
    }
  }

  // --- Validate records against existing schema ---
  const { columns, types: columnTypes } = getColumnTypes(pool, collection);

  const errors: ImportError[] = [];
  const validRecords: Record<string, unknown>[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const validationError = validateRecord(record, columns, columnTypes);
    if (validationError) {
      errors.push({ row: i, message: validationError });
    } else {
      // Remove system columns from import data so they're handled during insert
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) {
        if (!SYSTEM_COLUMNS.has(k)) {
          clean[k] = v;
        }
      }
      // Preserve id and created_at if explicitly provided
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

  // --- Insert records in a transaction ---
  let imported = 0;

  pool.writeTransaction(() => {
    const writeDb = pool.write();

    // Determine the union of all user columns across the import batch.
    // We always insert id, created_at, updated_at plus every user column seen.
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
      `INSERT OR REPLACE INTO "${collection}" (${colNames}) VALUES (${colPlaceholders})`
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

/** Generate a unique record ID for imports. */
function generateImportId(): string {
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  return `imp_${Date.now().toString(36)}_${Buffer.from(random).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Public API — Export
// ---------------------------------------------------------------------------

/**
 * Export collection records to CSV or JSON format.
 *
 * Supports filtering, sorting, field selection, limit, and offset.
 *
 * `GET /api/admin/:database/collections/:collection/export`
 */
export function exportData(
  pool: DatabasePool,
  collection: string,
  options: ExportOptions = {}
): ExportResult {
  validateIdentifier(collection, "collection name");

  const format = options.format ?? "json";

  // Determine which fields to export
  let exportFields: string[];
  if (options.fields && options.fields.length > 0) {
    exportFields = options.fields;
  } else {
    // Get column names from collection schema (excluding system columns)
    try {
      const info = getCollection(pool, collection);
      exportFields = info.schema.map((c: { name: string }) => c.name);
    } catch {
      // If getCollection fails, fall back to discovering from records
      exportFields = [];
    }
  }

  // Fetch records
  const records = listRecords(pool, collection, {
    filter: options.filter,
    sort: options.sort,
    direction: options.direction,
    limit: options.limit,
    offset: options.offset,
  });

  // Filter records to only include requested fields
  const filtered = exportFields.length > 0
    ? records.map((rec: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const f of exportFields) {
          if (f in rec) out[f] = rec[f];
        }
        return out;
      })
    : records;

  if (format === "csv") {
    const fields = exportFields.length > 0 ? exportFields : Array.from(
      new Set<string>(filtered.flatMap((r: Record<string, unknown>) => Object.keys(r)))
    );

    const csv = recordsToCSV(filtered, fields);

    return {
      data: csv,
      meta: {
        recordCount: records.length,
        format: "csv",
        collection,
      },
    };
  }

  // JSON format
  return {
    data: JSON.stringify({
      data: filtered,
      meta: {
        recordCount: records.length,
        format: "json",
        collection,
      },
    }),
    meta: {
      recordCount: records.length,
      format: "json",
      collection,
    },
  };
}

/**
 * Convert an array of records to a CSV string.
 */
function recordsToCSV(records: Record<string, unknown>[], fields: string[]): string {
  const lines: string[] = [];

  // Header row
  lines.push(fields.map((f) => escapeCSVField(f)).join(","));

  // Data rows
  for (const record of records) {
    const values = fields.map((field) => {
      const value = record[field];
      if (value === null || value === undefined) return "";
      if (typeof value === "object") {
        return escapeCSVField(JSON.stringify(value));
      }
      return escapeCSVField(String(value));
    });
    lines.push(values.join(","));
  }

  return lines.join("\n") + (records.length > 0 || fields.length > 0 ? "\n" : "");
}

/**
 * Escape a value for inclusion in a CSV field.
 * If the value contains commas, double-quotes, or newlines, it's wrapped in
 * double-quotes and any embedded quotes are doubled.
 */
function escapeCSVField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}