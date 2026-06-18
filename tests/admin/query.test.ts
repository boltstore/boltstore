/**
 * Tests for the admin raw SQL query endpoints.
 *
 * @module tests/admin/query
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../../src/db/manager";
import { executeReadQuery, executeWriteQuery, explainQuery } from "../../src/admin/query";
import { mkdirSync, rmSync } from "node:fs";

const TEST_DATA_DIR = "/tmp/boltstore_test_admin_query";
const TEST_APP = "adminqueryapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(() => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const { id: dbId } = manager.createDatabase(TEST_APP);
  pool = manager.get(dbId);
});

afterAll(() => cleanup());

beforeEach(() => {
  // Reset: drop all user tables, then recreate a test table
  const db = pool.write();
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const row of rows) {
    try { db.run(`DROP TABLE IF EXISTS "${row.name}"`); } catch {}
  }
  db.run(`CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, price REAL)`);
  db.run(`INSERT INTO items VALUES ('a', 'Alpha', 10.5)`);
  db.run(`INSERT INTO items VALUES ('b', 'Beta', 20.0)`);
  db.run(`INSERT INTO items VALUES ('c', 'Gamma', 30.0)`);
});

// ---------------------------------------------------------------------------
// executeReadQuery
// ---------------------------------------------------------------------------

describe("executeReadQuery", () => {
  test("executes a SELECT query", () => {
    const result = executeReadQuery(pool, "SELECT * FROM items");
    expect(result.rowCount).toBe(3);
    expect(result.columns).toContain("id");
    expect(result.columns).toContain("name");
    expect(result.rows[0].name).toBe("Alpha");
  });

  test("returns columns from result", () => {
    const result = executeReadQuery(pool, "SELECT name, price FROM items");
    expect(result.columns).toEqual(["name", "price"]);
    expect(result.rowCount).toBe(3);
  });

  test("executes SELECT with parameterized query", () => {
    const result = executeReadQuery(pool, "SELECT * FROM items WHERE price > ?", [15]);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0].name).toBe("Beta");
  });

  test("allows PRAGMA queries", () => {
    const result = executeReadQuery(pool, "PRAGMA table_info('items')");
    expect(result.rowCount).toBeGreaterThanOrEqual(3);
  });

  test("allows EXPLAIN queries", () => {
    const result = executeReadQuery(pool, "EXPLAIN SELECT * FROM items");
    expect(result.rowCount).toBeGreaterThan(0);
  });

  test("allows WITH (CTE) queries", () => {
    const result = executeReadQuery(pool, "WITH cheap AS (SELECT * FROM items WHERE price < 25) SELECT name FROM cheap");
    expect(result.rowCount).toBe(2);
  });

  test("rejects write queries (INSERT)", () => {
    try {
      executeReadQuery(pool, "INSERT INTO items VALUES ('d', 'Delta', 40)");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects write queries (DELETE)", () => {
    try {
      executeReadQuery(pool, "DELETE FROM items");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("returns empty columns for 0-row results", () => {
    const result = executeReadQuery(pool, "SELECT * FROM items WHERE price > 999");
    expect(result.rowCount).toBe(0);
    expect(result.columns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// executeWriteQuery
// ---------------------------------------------------------------------------

describe("executeWriteQuery", () => {
  test("executes INSERT", () => {
    const result = executeWriteQuery(pool, "INSERT INTO items VALUES (?, ?, ?)", ["d", "Delta", 40]);
    expect(result.changes).toBe(1);

    const rows = pool.read().query("SELECT * FROM items WHERE id='d'").all() as Record<string, unknown>[];
    expect(rows.length).toBe(1);
  });

  test("executes UPDATE", () => {
    const result = executeWriteQuery(pool, "UPDATE items SET price = ? WHERE id = ?", [99, "a"]);
    expect(result.changes).toBe(1);

    const row = pool.read().query("SELECT price FROM items WHERE id='a'").get() as { price: number };
    expect(row.price).toBe(99);
  });

  test("executes DELETE", () => {
    const result = executeWriteQuery(pool, "DELETE FROM items WHERE id = ?", ["b"]);
    expect(result.changes).toBe(1);

    const count = pool.read().query("SELECT COUNT(*) as cnt FROM items").get() as { cnt: number };
    expect(count.cnt).toBe(2);
  });

  test("executes CREATE TABLE", () => {
    executeWriteQuery(pool, "CREATE TABLE widgets (id TEXT PRIMARY KEY, label TEXT)");
    // Verify it exists
    const row = pool.read().query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='widgets'").get();
    expect(row).not.toBeNull();
  });

  test("executes DROP TABLE for non-system tables", () => {
    executeWriteQuery(pool, "DROP TABLE IF EXISTS items");
    const row = pool.read().query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='items'").get();
    expect(row).toBeNull();
  });

  test("rejects DROP TABLE on system tables (403)", () => {
    try {
      executeWriteQuery(pool, "DROP TABLE _collections");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects DROP TABLE on sqlite_ tables (403)", () => {
    try {
      executeWriteQuery(pool, "DROP TABLE sqlite_master");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects ALTER TABLE on system tables (403)", () => {
    try {
      executeWriteQuery(pool, "ALTER TABLE _collections ADD COLUMN x TEXT");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects dangerous statements (ATTACH, VACUUM, PRAGMA, CREATE TRIGGER)", () => {
    for (const stmt of ["ATTACH 'x.db' AS x", "VACUUM", "PRAGMA journal_mode", "CREATE TRIGGER trg BEFORE INSERT ON items BEGIN SELECT 1; END"]) {
      try {
        executeWriteQuery(pool, stmt);
        expect.unreachable(`Should have thrown for ${stmt}`);
      } catch (err: unknown) {
        const e = err as { status?: number };
        expect(e.status).toBe(403);
      }
    }
  });

  test("allows ALTER TABLE on user tables", () => {
    executeWriteQuery(pool, "ALTER TABLE items ADD COLUMN description TEXT DEFAULT ''");
    // Read from write connection to ensure the change is visible (WAL checkpoint may not have propagated yet)
    const rows = pool.write().query("PRAGMA table_info('items')").all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("description");
  });
});

// ---------------------------------------------------------------------------
// explainQuery
// ---------------------------------------------------------------------------

describe("explainQuery", () => {
  test("returns EXPLAIN QUERY PLAN for a SELECT", () => {
    const result = explainQuery(pool, "SELECT * FROM items WHERE price > 10");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]).toHaveProperty("detail");
  });

  test("returns EXPLAIN QUERY PLAN for SELECT with JOIN", () => {
    executeWriteQuery(pool, "CREATE TABLE other (id TEXT, ref TEXT)");
    const result = explainQuery(pool, "SELECT * FROM items JOIN other ON items.id = other.id");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test("rejects explaining an EXPLAIN", () => {
    try {
      explainQuery(pool, "EXPLAIN SELECT 1");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });
});