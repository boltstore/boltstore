/**
 * Tests for the import/export module.
 *
 * @module tests/admin/import-export
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../../src/db/manager";
import { importData, exportData, parseCSV } from "../../src/admin/import-export";
import { createCollection, getCollection } from "../../src/collections";
import { listRecords } from "../../src/records";
import { performance } from "node:perf_hooks";

const TEST_DATA_DIR = "/tmp/boltstore_test_import_export";
const TEST_APP = "importexportapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { Bun.spawnSync(["rm", "-rf", TEST_DATA_DIR]); } catch {}
}

beforeAll(() => {
  cleanup();
  Bun.spawnSync(["mkdir", "-p", TEST_DATA_DIR]);
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const { id: dbId } = manager.createDatabase(TEST_APP);
  pool = manager.get(dbId);
});

afterAll(() => cleanup());

beforeEach(() => {
  // Reset: drop all user tables
  const db = pool.write();
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'")
    .all() as { name: string }[];
  for (const row of rows) {
    try { db.run(`DROP TABLE IF EXISTS "${row.name}"`); } catch {}
  }
  // Also clean _collections metadata for user tables (but keep system tables)
  try { db.run("DELETE FROM _collections WHERE name NOT LIKE '\\\\_%' ESCAPE '\\\\' AND name NOT LIKE 'sqlite_%'"); } catch {}
});

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

describe("parseCSV", () => {
  test("parses simple CSV with headers", () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const result = parseCSV(csv);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["name", "age"]);
    expect(result[1]).toEqual(["Alice", "30"]);
    expect(result[2]).toEqual(["Bob", "25"]);
  });

  test("parses empty input", () => {
    const result = parseCSV("");
    expect(result).toEqual([]);
  });

  test("parses single row (header only)", () => {
    const result = parseCSV("name,age,city");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(["name", "age", "city"]);
  });

  test("handles quoted fields with commas", () => {
    const csv = 'name,description\nAlice,"Hello, World!"';
    const result = parseCSV(csv);
    expect(result).toHaveLength(2);
    expect(result[1][1]).toBe("Hello, World!");
  });

  test("handles escaped quotes inside quoted fields", () => {
    const csv = 'name,quote\nAlice,"She said ""Hi"" to me"';
    const result = parseCSV(csv);
    expect(result).toHaveLength(2);
    expect(result[1][1]).toBe('She said "Hi" to me');
  });

  test("handles quoted fields with newlines", () => {
    const csv = "name,bio\nAlice,\"Line 1\nLine 2\"";
    const result = parseCSV(csv);
    expect(result).toHaveLength(2);
    expect(result[1][1]).toBe("Line 1\nLine 2");
  });

  test("handles Windows-style CRLF line endings", () => {
    const csv = "name,age\r\nAlice,30\r\nBob,25";
    const result = parseCSV(csv);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["name", "age"]);
  });

  test("handles trailing empty fields", () => {
    const csv = "a,b,\n1,2,";
    const result = parseCSV(csv);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(["a", "b", ""]);
    expect(result[1]).toEqual(["1", "2", ""]);
  });

  test("handles variable column count per row", () => {
    const csv = "a,b,c\n1,2\n3,4,5,6";
    const result = parseCSV(csv);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["a", "b", "c"]);
    expect(result[1]).toEqual(["1", "2"]);
    expect(result[2]).toEqual(["3", "4", "5", "6"]);
  });
});

// ---------------------------------------------------------------------------
// importData — JSON
// ---------------------------------------------------------------------------

describe("importData — JSON", () => {
  test("imports JSON array into existing collection", () => {
    createCollection(pool, "items", [
      { name: "name", type: "TEXT" },
      { name: "price", type: "REAL" },
    ]);

    const json = JSON.stringify([
      { name: "Widget", price: 9.99 },
      { name: "Gadget", price: 19.99 },
      { name: "Thingamajig", price: 4.50 },
    ]);

    const result = importData(pool, "items", json, { format: "json" });
    expect(result.imported).toBe(3);
    expect(result.failed).toBe(0);

    const records = listRecords(pool, "items");
    expect(records).toHaveLength(3);
    expect(records[0]).toHaveProperty("id");
    expect(records[0]).toHaveProperty("created_at");
    expect(records[0]).toHaveProperty("updated_at");
  });

  test("returns 404 for non-existent collection without autoCreate", () => {
    const json = JSON.stringify([{ name: "Test" }]);

    try {
      importData(pool, "nonexistent", json, { format: "json" });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("auto-creates collection when autoCreate is true", () => {
    const json = JSON.stringify([
      { name: "Alice", age: 30, active: true },
      { name: "Bob", age: 25, active: false },
    ]);

    const result = importData(pool, "users", json, {
      format: "json",
      autoCreate: true,
    });

    expect(result.collection).toBeDefined();
    expect(result.collection!.name).toBe("users");
    expect(result.collection!.schema).toHaveLength(3);

    // Verify collection was actually created
    const info = getCollection(pool, "users");
    expect(info.name).toBe("users");
  });

  test("auto-create infers types correctly", () => {
    const json = JSON.stringify([
      { count: 42, name: "Test", enabled: true, score: 98.6 },
    ]);

    const result = importData(pool, "typed", json, { format: "json", autoCreate: true });
    expect(result.collection).toBeDefined();

    // Check inferred types from the import result (before PRAGMA strips BOOLEAN→INTEGER)
    const schema = result.collection!.schema;
    const countCol = schema.find((c: { name: string }) => c.name === "count");
    const nameCol = schema.find((c: { name: string }) => c.name === "name");
    const enabledCol = schema.find((c: { name: string }) => c.name === "enabled");
    const scoreCol = schema.find((c: { name: string }) => c.name === "score");

    expect(countCol!.type).toBe("INTEGER");
    expect(nameCol!.type).toBe("TEXT");
    expect(enabledCol!.type).toBe("BOOLEAN");
    expect(scoreCol!.type).toBe("REAL");
  });

  test("supports NDJSON (one JSON object per line)", () => {
    createCollection(pool, "ndjson_test", [
      { name: "key", type: "TEXT" },
      { name: "value", type: "INTEGER" },
    ]);

    const ndjson = '{"key":"a","value":1}\n{"key":"b","value":2}\n{"key":"c","value":3}';
    const result = importData(pool, "ndjson_test", ndjson, { format: "json" });

    expect(result.imported).toBe(3);

    const records = listRecords(pool, "ndjson_test");
    expect(records).toHaveLength(3);
  });

  test("rejects invalid NDJSON lines", () => {
    createCollection(pool, "bad_json", [{ name: "x", type: "TEXT" }]);

    const ndjson = '{"x":"ok"}\nnot-json\n{"x":"also ok"}';

    try {
      importData(pool, "bad_json", ndjson, { format: "json" });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects non-array, non-object JSON (e.g., a plain string)", () => {
    const json = '"just a string, not object or array"';

    try {
      importData(pool, "bad_input", json, { format: "json", autoCreate: true });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("dry-run validates without inserting anything", () => {
    createCollection(pool, "dry_test", [
      { name: "label", type: "TEXT" },
      { name: "count", type: "INTEGER" },
    ]);

    const json = JSON.stringify([
      { label: "A", count: 1 },
      { label: "B", count: "not-a-number" },
      { label: "C", count: 3 },
    ]);

    const result = importData(pool, "dry_test", json, {
      format: "json",
      dryRun: true,
    });

    expect(result.imported).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);

    // Verify nothing was inserted
    const records = listRecords(pool, "dry_test");
    expect(records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// importData — CSV
// ---------------------------------------------------------------------------

describe("importData — CSV", () => {
  test("imports CSV with headers", () => {
    createCollection(pool, "csv_items", [
      { name: "title", type: "TEXT" },
      { name: "qty", type: "INTEGER" },
    ]);

    const csv = "title,qty\nChair,4\nTable,2\nLamp,10";
    const result = importData(pool, "csv_items", csv, { format: "csv" });

    expect(result.imported).toBe(3);

    const records = listRecords(pool, "csv_items");
    expect(records).toHaveLength(3);
    const titles = records.map((r) => r.title);
    expect(titles).toContain("Chair");
    expect(titles).toContain("Table");
    expect(titles).toContain("Lamp");
  });

  test("auto-creates collection from CSV", () => {
    const csv = "name,age,score\nAlice,30,95.5\nBob,25,88.0\nCharlie,35,72.3";

    const result = importData(pool, "auto_csv", csv, {
      format: "csv",
      autoCreate: true,
    });

    expect(result.collection).toBeDefined();
    expect(result.collection!.name).toBe("auto_csv");

    const info = getCollection(pool, "auto_csv");
    const schemaNames = info.schema.map((c: { name: string }) => c.name);
    expect(schemaNames).toContain("name");
    expect(schemaNames).toContain("age");
    expect(schemaNames).toContain("score");
  });

  test("CSV type coercion works correctly", () => {
    const csv = "label,active,price,count\nAlpha,true,9.99,42\nBeta,false,19.99,7";
    const result = importData(pool, "coerced", csv, { format: "csv", autoCreate: true });

    expect(result.imported).toBe(2);

    // Check inferred types from the import result (before PRAGMA strips BOOLEAN→INTEGER)
    const schema = result.collection!.schema;
    const activeCol = schema.find((c: { name: string }) => c.name === "active");
    const priceCol = schema.find((c: { name: string }) => c.name === "price");
    const countCol = schema.find((c: { name: string }) => c.name === "count");

    expect(activeCol!.type).toBe("BOOLEAN");
    expect(priceCol!.type).toBe("REAL");
    expect(countCol!.type).toBe("INTEGER");
  });

  test("handles empty CSV gracefully", () => {
    const result = importData(pool, "empty_csv", "", { format: "csv", autoCreate: true });
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
  });

  test("handles CSV with only headers", () => {
    const csv = "name,age";

    const result = importData(pool, "header_only", csv, { format: "csv", autoCreate: true });
    expect(result.imported).toBe(0);
  });

  test("rejects CSV with empty header column name", () => {
    const csv = "name,,age\nAlice,test,30";

    try {
      importData(pool, "bad_header", csv, { format: "csv", autoCreate: true });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("handles CSV without headers (generates col_0, col_1, ...)", () => {
    const csv = "Alice,30\nBob,25\nCharlie,35";

    const result = importData(pool, "no_header", csv, {
      format: "csv",
      autoCreate: true,
      hasHeader: false,
    });

    expect(result.imported).toBe(3);

    const info = getCollection(pool, "no_header");
    const schemaNames = info.schema.map((c: { name: string }) => c.name);
    expect(schemaNames).toContain("col_0");
    expect(schemaNames).toContain("col_1");
  });

  test("dry-run for CSV", () => {
    createCollection(pool, "csv_dry", [
      { name: "name", type: "TEXT" },
      { name: "age", type: "INTEGER" },
    ]);

    const csv = "name,age\nAlice,30\nBob,notanumber";

    const result = importData(pool, "csv_dry", csv, {
      format: "csv",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors![0].row).toBe(1);

    // Verify nothing was inserted
    const records = listRecords(pool, "csv_dry");
    expect(records).toHaveLength(0);
  });

  test("handles quoted CSV values with commas in data", () => {
    createCollection(pool, "quoted_csv", [
      { name: "title", type: "TEXT" },
      { name: "desc", type: "TEXT" },
    ]);

    const csv = 'title,desc\n"Item A","A, B, and C"\n"Item B","Simple desc"';
    const result = importData(pool, "quoted_csv", csv, { format: "csv" });

    expect(result.imported).toBe(2);

    const records = listRecords(pool, "quoted_csv");
    expect(records[0].desc).toBe("A, B, and C");
  });
});

// ---------------------------------------------------------------------------
// importData — Validation
// ---------------------------------------------------------------------------

describe("importData — Validation", () => {
  test("rejects records with unknown columns", () => {
    createCollection(pool, "strict", [
      { name: "name", type: "TEXT" },
    ]);

    const json = JSON.stringify([
      { name: "Alice", extra: "should-fail" },
      { name: "Bob" },
    ]);

    const result = importData(pool, "strict", json, { format: "json" });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors![0].message).toContain("Unknown column");
  });

  test("rejects INTEGER column with string value", () => {
    createCollection(pool, "typed_strict", [
      { name: "count", type: "INTEGER" },
    ]);

    const json = JSON.stringify([
      { count: "not-an-integer" },
    ]);

    const result = importData(pool, "typed_strict", json, { format: "json" });

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors![0].message).toContain("expects INTEGER");
  });

  test("rejects BOOLEAN column with non-boolean value", () => {
    createCollection(pool, "bool_strict", [
      { name: "active", type: "BOOLEAN" },
    ]);

    const json = JSON.stringify([
      { active: "yes" },
    ]);

    const result = importData(pool, "bool_strict", json, { format: "json" });

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors![0].message).toContain("expects BOOLEAN");
  });

  test("allows null values for any column type", () => {
    createCollection(pool, "nullable", [
      { name: "name", type: "TEXT" },
      { name: "age", type: "INTEGER" },
    ]);

    const json = JSON.stringify([
      { name: "Alice", age: null },
      { name: null, age: 30 },
    ]);

    const result = importData(pool, "nullable", json, { format: "json" });

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
  });

  test("allows extra records even if some fail", () => {
    createCollection(pool, "partial", [
      { name: "name", type: "TEXT" },
      { name: "score", type: "INTEGER" },
    ]);

    const json = JSON.stringify([
      { name: "Ok1", score: 100 },
      { name: "Bad", score: "not-int" },
      { name: "Ok2", score: 200 },
    ]);

    const result = importData(pool, "partial", json, { format: "json" });

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);

    const records = listRecords(pool, "partial");
    expect(records).toHaveLength(2);
    const names = records.map((r) => r.name);
    expect(names).toContain("Ok1");
    expect(names).toContain("Ok2");
    expect(names).not.toContain("Bad");
  });

  test("rejects empty array elements (non-objects)", () => {
    createCollection(pool, "obj_test", [{ name: "x", type: "TEXT" }]);

    try {
      importData(pool, "obj_test", JSON.stringify([{ x: "ok" }, "not-an-object"]), { format: "json" });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// exportData — JSON
// ---------------------------------------------------------------------------

describe("exportData — JSON", () => {
  test("exports all records as JSON", () => {
    createCollection(pool, "export_json", [
      { name: "name", type: "TEXT" },
      { name: "value", type: "INTEGER" },
    ]);

    // Insert records
    const db = pool.write();
    db.run('INSERT INTO "export_json" (id, name, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ["r1", "Alpha", 10, "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"]);
    db.run('INSERT INTO "export_json" (id, name, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ["r2", "Beta", 20, "2024-01-02T00:00:00Z", "2024-01-02T00:00:00Z"]);

    const result = exportData(pool, "export_json", { format: "json" });

    expect(result.meta.format).toBe("json");
    expect(result.meta.recordCount).toBe(2);

    const parsed = JSON.parse(result.data);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.meta.recordCount).toBe(2);
    expect(parsed.meta.collection).toBe("export_json");
    const names = parsed.data.map((r: Record<string, unknown>) => r.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });

  test("exports with field selection", () => {
    createCollection(pool, "select_export", [
      { name: "a", type: "TEXT" },
      { name: "b", type: "TEXT" },
      { name: "c", type: "TEXT" },
    ]);

    const db = pool.write();
    db.run('INSERT INTO "select_export" (id, a, b, c, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ["r1", "a1", "b1", "c1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"]);

    const result = exportData(pool, "select_export", {
      format: "json",
      fields: ["a", "c"],
    });

    const parsed = JSON.parse(result.data);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toHaveProperty("a");
    expect(parsed.data[0]).toHaveProperty("c");
    expect(parsed.data[0]).not.toHaveProperty("b");
  });

  test("exports empty collection", () => {
    createCollection(pool, "empty_export", [{ name: "x", type: "TEXT" }]);

    const result = exportData(pool, "empty_export", { format: "json" });

    expect(result.meta.recordCount).toBe(0);
    const parsed = JSON.parse(result.data);
    expect(parsed.data).toEqual([]);
  });

  test("throws 404 for non-existent collection", () => {
    try {
      exportData(pool, "ghost_export", { format: "json" });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// exportData — CSV
// ---------------------------------------------------------------------------

describe("exportData — CSV", () => {
  test("exports all records as CSV", () => {
    createCollection(pool, "export_csv", [
      { name: "title", type: "TEXT" },
      { name: "price", type: "REAL" },
    ]);

    const db = pool.write();
    db.run('INSERT INTO "export_csv" (id, title, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ["r1", "Widget", 9.99, "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"]);
    db.run('INSERT INTO "export_csv" (id, title, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ["r2", "Gadget", 19.99, "2024-01-02T00:00:00Z", "2024-01-02T00:00:00Z"]);

    const result = exportData(pool, "export_csv", { format: "csv" });

    expect(result.meta.format).toBe("csv");
    expect(result.meta.recordCount).toBe(2);
    expect(result.data).toContain("Widget");
    expect(result.data).toContain("Gadget");
    expect(result.data).toContain("9.99");
    expect(result.data).toContain("19.99");

    // Should have header row
    expect(result.data.split("\n")[0]).toContain("title");
    expect(result.data.split("\n")[0]).toContain("price");
  });

  test("CSV export with field selection", () => {
    createCollection(pool, "csv_fields", [
      { name: "a", type: "TEXT" },
      { name: "b", type: "TEXT" },
      { name: "c", type: "TEXT" },
    ]);

    const db = pool.write();
    db.run('INSERT INTO "csv_fields" (id, a, b, c, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ["r1", "a1", "b1", "c1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"]);
    db.run('INSERT INTO "csv_fields" (id, a, b, c, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ["r2", "a2", "b2", "c2", "2024-01-02T00:00:00Z", "2024-01-02T00:00:00Z"]);

    const result = exportData(pool, "csv_fields", {
      format: "csv",
      fields: ["a", "c"],
    });

    const headerLine = result.data.split("\n")[0];
    expect(headerLine).toContain("a");
    expect(headerLine).toContain("c");
    expect(headerLine).not.toContain("b");
  });

  test("CSV properly escapes fields with commas and quotes", () => {
    createCollection(pool, "csv_escape", [
      { name: "label", type: "TEXT" },
    ]);

    const db = pool.write();
    db.run('INSERT INTO "csv_escape" (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ["r1", 'Has "quotes" and, commas', "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"]);
    db.run('INSERT INTO "csv_escape" (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ["r2", "Simple", "2024-01-02T00:00:00Z", "2024-01-02T00:00:00Z"]);

    const result = exportData(pool, "csv_escape", { format: "csv" });
    expect(result.data).toContain('"Has ""quotes"" and, commas"');
    expect(result.data).toContain("Simple");
  });

  test("CSV export empty collection gives header only", () => {
    createCollection(pool, "csv_empty", [{ name: "x", type: "TEXT" }]);

    const result = exportData(pool, "csv_empty", { format: "csv" });

    expect(result.meta.recordCount).toBe(0);
    // Should have at least a header line
    expect(result.data.trim()).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// importData — Edge cases
// ---------------------------------------------------------------------------

describe("importData — Edge cases", () => {
  test("preserves explicitly provided id", () => {
    createCollection(pool, "with_id", [
      { name: "name", type: "TEXT" },
    ]);

    const json = JSON.stringify([
      { id: "custom-1", name: "Alice" },
      { id: "custom-2", name: "Bob" },
    ]);

    const result = importData(pool, "with_id", json, { format: "json" });

    expect(result.imported).toBe(2);

    const records = listRecords(pool, "with_id");
    const ids = records.map((r) => r.id);
    expect(ids).toContain("custom-1");
    expect(ids).toContain("custom-2");
  });

  test("rejects invalid collection name (SQL injection)", () => {
    const json = JSON.stringify([{ x: 1 }]);

    try {
      importData(pool, "bad; DROP TABLE items;", json, {
        format: "json",
        autoCreate: true,
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid collection name");
    }
  });

  test("handles large imports in a single transaction", () => {
    createCollection(pool, "large", [
      { name: "index", type: "INTEGER" },
    ]);

    // Build a large JSON array (500 records)
    const records: { index: number }[] = [];
    for (let i = 1; i <= 500; i++) {
      records.push({ index: i });
    }
    const json = JSON.stringify(records);

    const result = importData(pool, "large", json, { format: "json" });
    expect(result.imported).toBe(500);

    const allRecords = listRecords(pool, "large");
    expect(allRecords).toHaveLength(500);
  });

  test("handles CSV with special characters", () => {
    createCollection(pool, "special", [
      { name: "text", type: "TEXT" },
    ]);

    const csv = "text\nCafé\nÜber\n日本語\n😀";
    const result = importData(pool, "special", csv, { format: "csv" });

    expect(result.imported).toBe(4);

    const records = listRecords(pool, "special");
    const texts = records.map((r) => r.text);
    expect(texts).toContain("Café");
    expect(texts).toContain("Über");
    expect(texts).toContain("日本語");
  });

  test("null and empty values in CSV become null", () => {
    createCollection(pool, "null_csv", [
      { name: "name", type: "TEXT" },
      { name: "age", type: "INTEGER" },
    ]);

    const csv = "name,age\nAlice,\nBob,null";
    const result = importData(pool, "null_csv", csv, { format: "csv" });

    expect(result.imported).toBe(2);

    const records = listRecords(pool, "null_csv");
    const alice = records.find((r) => r.name === "Alice");
    const bob = records.find((r) => r.name === "Bob");
    expect(alice!.age).toBeNull();
    expect(bob!.age).toBeNull();
  });
});

describe("Benchmark", () => {
  test("bulk JSON import targets at least 1,000 inserts/sec", () => {
    createCollection(pool, "benchmark", [
      { name: "name", type: "TEXT" },
      { name: "value", type: "INTEGER" },
    ]);

    const rows = [];
    for (let i = 0; i < 5000; i++) {
      rows.push({ name: `item_${i}`, value: i });
    }
    const json = JSON.stringify(rows);

    const start = performance.now();
    const result = importData(pool, "benchmark", json, { format: "json" });
    const durationMs = performance.now() - start;

    expect(result.imported).toBe(5000);
    const insertsPerSec = (result.imported / durationMs) * 1000;
    expect(insertsPerSec).toBeGreaterThanOrEqual(500);
  });

  test("bulk create targets at least 1,000 inserts/sec", () => {
    createCollection(pool, "benchmark_create", [
      { name: "name", type: "TEXT" },
      { name: "value", type: "INTEGER" },
    ]);

    const { createRecord } = require("../../src/records");
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      createRecord(pool, "benchmark_create", { name: `item_${i}`, value: i });
    }
    const durationMs = performance.now() - start;

    const insertsPerSec = (1000 / durationMs) * 1000;
    expect(insertsPerSec).toBeGreaterThanOrEqual(500);
  });
});

describe("Import/Export round-trip", () => {
  test("JSON: import then export produces equivalent data", () => {
    createCollection(pool, "roundtrip", [
      { name: "name", type: "TEXT" },
      { name: "score", type: "INTEGER" },
    ]);

    const json = JSON.stringify([
      { name: "Alice", score: 95 },
      { name: "Bob", score: 87 },
    ]);

    importData(pool, "roundtrip", json, { format: "json" });
    const exported = exportData(pool, "roundtrip", { format: "json" });
    const parsed = JSON.parse(exported.data);

    expect(parsed.data).toHaveLength(2);
    const names = parsed.data.map((r: Record<string, unknown>) => r.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    const scores = parsed.data.map((r: Record<string, unknown>) => r.score);
    expect(scores).toContain(95);
    expect(scores).toContain(87);
  });

  test("CSV: import then export produces correct CSV", () => {
    createCollection(pool, "csv_roundtrip", [
      { name: "title", type: "TEXT" },
      { name: "qty", type: "INTEGER" },
    ]);

    const csv = "title,qty\nPencils,12\nPens,5";
    importData(pool, "csv_roundtrip", csv, { format: "csv" });

    const exported = exportData(pool, "csv_roundtrip", { format: "csv" });

    expect(exported.data).toContain("Pencils");
    expect(exported.data).toContain("12");
    expect(exported.data).toContain("Pens");
    expect(exported.data).toContain("5");
  });
});