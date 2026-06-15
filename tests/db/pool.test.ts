/**
 * Tests for the SQLite database pool.
 *
 * @module tests/db/pool
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { DatabasePool } from "../../src/db/pool";
import { unlinkSync } from "fs";

const TEST_DB_PATH = "./data/test-boltstore.db";

let pool: DatabasePool;

beforeAll(() => {
  pool = new DatabasePool({ path: TEST_DB_PATH });
});

afterAll(() => {
  pool.close();
  try {
    unlinkSync(TEST_DB_PATH);
    unlinkSync(TEST_DB_PATH + "-wal");
    unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("DatabasePool", () => {
  test("creates with correct read connections", () => {
    const stats = pool.stats();
    expect(stats.readConnections).toBe(4);
    expect(stats.writeConnection).toBe(true);
    expect(stats.path).toContain("test-boltstore.db");
  });

  test("write() returns a database instance", () => {
    const db = pool.write();
    expect(db).toBeDefined();
  });

  test("read() returns a database instance", () => {
    const db = pool.read();
    expect(db).toBeDefined();
  });

  test("can create table, insert, update, delete via write connection directly", () => {
    const w = pool.write();

    // Create table and insert
    w.run("CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
    w.run("INSERT INTO test_items (name) VALUES (?)", ["alpha"]);
    w.run("INSERT INTO test_items (name) VALUES (?)", ["beta"]);

    // Read from write connection
    let rows = w.query("SELECT * FROM test_items ORDER BY id").all() as { id: number; name: string }[];
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("alpha");
    expect(rows[1].name).toBe("beta");

    // Read from read pool
    let read = pool.read();
    let readRows = read.query("SELECT * FROM test_items ORDER BY id").all() as { id: number; name: string }[];
    expect(readRows.length).toBe(2);
    expect(readRows[0].name).toBe("alpha");
    expect(readRows[1].name).toBe("beta");

    // Update
    w.run("UPDATE test_items SET name = ? WHERE name = ?", ["updated-alpha", "alpha"]);
    w.run("PRAGMA wal_checkpoint(PASSIVE)");

    // Read updated data from read pool
    readRows = read.query("SELECT * FROM test_items ORDER BY id").all() as { id: number; name: string }[];
    expect(readRows.length).toBe(2);
    expect(readRows[0].name).toBe("updated-alpha");

    // Delete
    w.run("DELETE FROM test_items WHERE name = ?", ["beta"]);
    w.run("PRAGMA wal_checkpoint(PASSIVE)");

    // Verify from read pool
    readRows = read.query("SELECT * FROM test_items ORDER BY id").all() as { id: number; name: string }[];
    expect(readRows.length).toBe(1);
    expect(readRows[0].name).toBe("updated-alpha");
  });

  test("write connection inserts have lastInsertRowid", () => {
    const w = pool.write();
    const info = w.run("INSERT INTO test_items (name) VALUES (?)", ["rowid-test"]);
    expect(Number(info.lastInsertRowid)).toBeGreaterThan(0);
    expect(info.changes).toBe(1);
  });

  test("round-robin read distribution returns identical data", () => {
    const db1 = pool.read();
    const db2 = pool.read();
    const r1 = db1.query("SELECT count(*) as c FROM test_items").get() as { c: number };
    const r2 = db2.query("SELECT count(*) as c FROM test_items").get() as { c: number };
    expect(r1.c).toBe(r2.c);
  });

  test("can clean up test table via writeTransaction", () => {
    pool.writeTransaction(() => {
      const w = pool.write();
      w.run("DROP TABLE IF EXISTS test_items");
    });

    const read = pool.read();
    const tables = read.query("SELECT name FROM sqlite_master WHERE type='table' AND name='test_items'").all();
    expect(tables.length).toBe(0);
  });
});