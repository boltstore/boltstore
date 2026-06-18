/**
 * Tests for DatabaseManager — multi-application database management.
 *
 * @module tests/db/manager
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { DatabaseManager } from "../../src/db/manager";
import { mkdirSync, rmSync } from "node:fs";

const TEST_DATA_DIR = "/tmp/boltstore_test_manager";

let manager: DatabaseManager;
let myappId: string;

function cleanup() {
  try {
    if (manager) manager.close();
  } catch {
    // ignore
  }
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

beforeAll(() => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
});

afterAll(() => {
  cleanup();
});

describe("DatabaseManager", () => {
  test("starts with empty database list", () => {
    const databases = manager.listDatabases();
    expect(databases).toEqual([]);
  });

  test("creates a new application database", () => {
    const result = manager.createDatabase("myapp");
    expect(result.name).toBe("myapp");
    expect(result.id).toStartWith("dbs_");
    expect(result.path).toContain(result.id);
    expect(result.path).toContain(".db");
    expect(result.createdAt).toBeTruthy();
    myappId = result.id;
  });

  test("listDatabases includes created databases", () => {
    const databases = manager.listDatabases();
    expect(databases).toHaveLength(1);
    expect(databases[0].name).toBe("myapp");
  });

  test("get() returns a pool for an existing database", () => {
    const pool = manager.get(myappId);
    expect(pool).toBeDefined();
    expect(pool.read()).toBeDefined();
    expect(pool.write()).toBeDefined();
  });

  test("exists() returns true for existing database", () => {
    expect(manager.exists(myappId)).toBe(true);
  });

  test("exists() returns false for non-existent database", () => {
    expect(manager.exists("ghost_app")).toBe(false);
  });

  test("get() caches pool — same instance on repeated calls", () => {
    const pool1 = manager.get(myappId);
    const pool2 = manager.get(myappId);
    expect(pool1).toBe(pool2);
  });

  test("rejects duplicate database names (409)", () => {
    try {
      manager.createDatabase("myapp");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("already exists");
      expect(e.status).toBe(409);
    }
  });

  test("rejects reserved names (403)", () => {
    try {
      manager.createDatabase("sqlite_master");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot use reserved name");
      expect(e.status).toBe(403);
    }
  });

  test("rejects names starting with underscore (400)", () => {
    try {
      manager.createDatabase("_secret");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("cannot start with underscore");
      expect(e.status).toBe(400);
    }
  });

  test("rejects invalid database names", () => {
    try {
      manager.createDatabase("my app");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid database name");
    }
  });

  test("get() throws 404 for non-existent database", () => {
    try {
      manager.get("dbs_nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("not found");
      expect(e.status).toBe(404);
    }
  });

  test("creates multiple databases with isolated files", () => {
    manager.createDatabase("app_one");
    manager.createDatabase("app_two");
    manager.createDatabase("app_three");

    const databases = manager.listDatabases();
    // myapp + app_one + app_two + app_three = 4
    expect(databases.length).toBeGreaterThanOrEqual(4);
    const names = databases.map((d) => d.name);
    expect(names).toContain("app_one");
    expect(names).toContain("app_two");
    expect(names).toContain("app_three");
  });

  test("deletes a database", () => {
    const { id: tempId } = manager.createDatabase("temporary");
    expect(manager.exists(tempId)).toBe(true);

    manager.deleteDatabase(tempId);
    expect(manager.exists(tempId)).toBe(false);
    expect(manager.listDatabases().find((d) => d.name === "temporary")).toBeUndefined();

    // get() should now fail with 404
    try {
      manager.get(tempId);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("deleteDatabase throws 404 for non-existent database", () => {
    try {
      manager.deleteDatabase("dbs_ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("not found");
      expect(e.status).toBe(404);
    }
  });

  test("deleteDatabase rejects system databases (403)", () => {
    try {
      manager.deleteDatabase("dbs__system");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("deleted database pool is closed and removed from cache", () => {
    const { id: cacheId } = manager.createDatabase("cache_test");
    const pool1 = manager.get(cacheId);

    manager.deleteDatabase(cacheId);

    // Database should not exist after deletion
    expect(manager.exists(cacheId)).toBe(false);
    expect(manager.listDatabases().find((d) => d.name === "cache_test")).toBeUndefined();
  });

  test("databases are isolated — operations on one do not affect another", () => {
    const { id: isolatedAId } = manager.createDatabase("isolated_a");
    const { id: isolatedBId } = manager.createDatabase("isolated_b");

    const poolA = manager.get(isolatedAId);
    const poolB = manager.get(isolatedBId);

    // Write to pool A
    poolA.write().run("CREATE TABLE test_a (value TEXT)");
    poolA.write().run("INSERT INTO test_a VALUES ('hello from A')");

    // Write to pool B
    poolB.write().run("CREATE TABLE test_b (value TEXT)");
    poolB.write().run("INSERT INTO test_b VALUES ('hello from B')");

    // Verify isolation
    const rowsA = poolA.read().query("SELECT value FROM test_a").all() as { value: string }[];
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].value).toBe("hello from A");

    const rowsB = poolB.read().query("SELECT value FROM test_b").all() as { value: string }[];
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].value).toBe("hello from B");

    // Pool A cannot see pool B's table
    try {
      poolA.read().query("SELECT * FROM test_b").all();
      expect.unreachable("Should have thrown");
    } catch {
      // Expected — table doesn't exist in pool A
    }

    // Cleanup
    manager.deleteDatabase(isolatedAId);
    manager.deleteDatabase(isolatedBId);
  });
});