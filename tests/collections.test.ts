/**
 * Tests for the collections (tables) management module.
 *
 * Uses DatabaseManager to simulate multi-database support — each test
 * creates an app database, then exercises collection CRUD against it.
 *
 * @module tests/collections
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import {
  createCollection,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
} from "../src/collections";
import { mkdirSync, rmSync } from "node:fs";

const TEST_DATA_DIR = "/tmp/boltstore_test_data";
const TEST_APP = "testapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;

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
  // Create a test application database
  manager.createDatabase(TEST_APP);
  pool = manager.get(TEST_APP);
});

afterAll(() => {
  cleanup();
});

// Reset state before each test by dropping all user collections
beforeEach(() => {
  const db = pool.write();
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const row of rows) {
    try {
      db.run(`DROP TABLE IF EXISTS "${row.name}"`);
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// createCollection
// ---------------------------------------------------------------------------

describe("createCollection", () => {
  test("creates a collection with valid columns", () => {
    const result = createCollection(pool, "users", [
      { name: "name", type: "TEXT" },
      { name: "age", type: "INTEGER" },
    ]);

    expect(result.name).toBe("users");
    expect(result.schema).toHaveLength(2);
    expect(result.recordCount).toBe(0);
    expect(result.createdAt).toBeTruthy();
  });

  test("auto-includes system columns (id, created_at, updated_at)", () => {
    createCollection(pool, "posts", [{ name: "title", type: "TEXT" }]);

    const info = getCollection(pool, "posts");
    expect(info.schema).toHaveLength(1);
    expect(info.schema[0].name).toBe("title");
  });

  test("returns 400 when no columns provided", () => {
    try {
      createCollection(pool, "empty", []);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("At least one column is required");
      expect(e.status).toBe(400);
    }
  });

  test("returns 409 on duplicate collection name", () => {
    createCollection(pool, "dupes", [{ name: "x", type: "TEXT" }]);

    try {
      createCollection(pool, "dupes", [{ name: "y", type: "INTEGER" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("already exists");
      expect(e.status).toBe(409);
    }
  });

  test("rejects invalid column types", () => {
    try {
      createCollection(pool, "bad", [{ name: "x", type: "UNKNOWN" as never }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Invalid column type");
      expect(e.status).toBe(400);
    }
  });

  test("rejects reserved system table names", () => {
    try {
      createCollection(pool, "_collections", [{ name: "x", type: "TEXT" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot create reserved table");
      expect(e.status).toBe(403);
    }

    try {
      createCollection(pool, "sqlite_master", [{ name: "x", type: "TEXT" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot create reserved table");
      expect(e.status).toBe(403);
    }
  });

  test("rejects invalid collection names (SQL injection attempt)", () => {
    try {
      createCollection(pool, "users; DROP TABLE _collections;", [{ name: "x", type: "TEXT" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid collection name");
    }

    try {
      createCollection(pool, "1bad_table", [{ name: "x", type: "TEXT" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid collection name");
    }
  });

  test("rejects system column name collisions", () => {
    try {
      createCollection(pool, "items", [{ name: "id", type: "INTEGER" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot use reserved column name");
      expect(e.status).toBe(400);
    }
  });

  test("supports all valid column types", () => {
    createCollection(pool, "all_types", [
      { name: "text_col", type: "TEXT" },
      { name: "int_col", type: "INTEGER" },
      { name: "real_col", type: "REAL" },
      { name: "blob_col", type: "BLOB" },
      { name: "bool_col", type: "BOOLEAN" },
      { name: "date_col", type: "DATETIME" },
    ]);

    const info = getCollection(pool, "all_types");
    expect(info.schema).toHaveLength(6);
    const types = info.schema.map((c) => c.type);
    expect(types).toContain("TEXT");
    expect(types).toContain("INTEGER");
    expect(types).toContain("REAL");
    expect(types).toContain("BLOB");
    expect(types.length).toBe(6);
  });

  test("handles required, unique, and default constraints", () => {
    createCollection(pool, "constrained", [
      { name: "email", type: "TEXT", unique: true },
      { name: "score", type: "INTEGER", default: 0 },
      { name: "active", type: "BOOLEAN", default: true },
      { name: "bio", type: "TEXT", default: null },
      { name: "tag", type: "TEXT", default: "draft" },
    ]);

    const db = pool.read();
    const rows = db.query('PRAGMA table_info("constrained")').all() as Record<string, unknown>[];

    const emailCol = rows.find((r) => r.name === "email");
    expect(emailCol).toBeDefined();

    const scoreCol = rows.find((r) => r.name === "score");
    expect(scoreCol).toBeDefined();
    expect(String(scoreCol!.dflt_value)).toBe("0");

    const activeCol = rows.find((r) => r.name === "active");
    expect(activeCol).toBeDefined();
    expect(Number(activeCol!.dflt_value)).toBe(1);

    const bioCol = rows.find((r) => r.name === "bio");
    expect(bioCol).toBeDefined();
    expect(bioCol!.dflt_value).toBe("NULL");

    const tagCol = rows.find((r) => r.name === "tag");
    expect(tagCol).toBeDefined();
    expect(String(tagCol!.dflt_value)).toBe("'draft'");
  });
});

// ---------------------------------------------------------------------------
// listCollections
// ---------------------------------------------------------------------------

describe("listCollections", () => {
  test("returns empty list when no collections exist", () => {
    const result = listCollections(pool);
    expect(result).toEqual([]);
  });

  test("lists all created collections", () => {
    createCollection(pool, "cats", [{ name: "breed", type: "TEXT" }]);
    createCollection(pool, "dogs", [{ name: "breed", type: "TEXT" }]);

    const result = listCollections(pool);
    expect(result).toHaveLength(2);
    const names = result.map((c) => c.name).sort();
    expect(names).toEqual(["cats", "dogs"]);
  });

  test("each collection has required fields", () => {
    createCollection(pool, "apples", [{ name: "color", type: "TEXT" }]);
    const result = listCollections(pool);
    expect(result).toHaveLength(1);

    const c = result[0];
    expect(c.name).toBe("apples");
    expect(c.schema).toBeDefined();
    expect(Array.isArray(c.schema)).toBe(true);
    expect(c.recordCount).toBe(0);
    expect(c.createdAt).toBeTruthy();
    expect(c.updatedAt).toBeTruthy();
  });

  test("does not list system tables", () => {
    createCollection(pool, "visible", [{ name: "x", type: "TEXT" }]);
    const result = listCollections(pool);
    const names = result.map((c) => c.name);
    expect(names).not.toContain("_collections");
    expect(names).not.toContain("sqlite_master");
  });
});

// ---------------------------------------------------------------------------
// getCollection
// ---------------------------------------------------------------------------

describe("getCollection", () => {
  test("returns collection details", () => {
    createCollection(pool, "books", [
      { name: "title", type: "TEXT" },
      { name: "pages", type: "INTEGER" },
    ]);

    const info = getCollection(pool, "books");
    expect(info.name).toBe("books");
    expect(info.schema).toHaveLength(2);
    expect(info.schema[0].name).toBe("title");
    expect(info.schema[0].type).toBe("TEXT");
    expect(info.schema[1].name).toBe("pages");
    expect(info.schema[1].type).toBe("INTEGER");
    expect(info.recordCount).toBe(0);
  });

  test("returns 404 for non-existent collection", () => {
    try {
      getCollection(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("not found");
      expect(e.status).toBe(404);
    }
  });

  test("rejects invalid collection name", () => {
    try {
      getCollection(pool, "bad name!");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid collection name");
    }
  });

  test("excludes system columns from schema output", () => {
    createCollection(pool, "widgets", [{ name: "color", type: "TEXT" }]);
    const info = getCollection(pool, "widgets");

    const schemaNames = info.schema.map((c) => c.name);
    expect(schemaNames).not.toContain("id");
    expect(schemaNames).not.toContain("created_at");
    expect(schemaNames).not.toContain("updated_at");
  });
});

// ---------------------------------------------------------------------------
// updateCollection
// ---------------------------------------------------------------------------

describe("updateCollection", () => {
  test("adds new columns to existing collection", () => {
    createCollection(pool, "inventory", [
      { name: "item", type: "TEXT" },
    ]);

    const result = updateCollection(pool, "inventory", [
      { name: "quantity", type: "INTEGER", default: 0 },
      { name: "price", type: "REAL" },
    ]);

    expect(result.name).toBe("inventory");
    expect(result.schema).toHaveLength(3);
    expect(result.schema[1].name).toBe("quantity");
    expect(result.schema[2].name).toBe("price");
  });

  test("returns 404 for non-existent collection", () => {
    try {
      updateCollection(pool, "ghost", [{ name: "x", type: "TEXT" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("not found");
      expect(e.status).toBe(404);
    }
  });

  test("returns 409 for duplicate column names", () => {
    createCollection(pool, "dupe_cols", [{ name: "name", type: "TEXT" }]);

    try {
      updateCollection(pool, "dupe_cols", [{ name: "name", type: "INTEGER" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("already exists");
      expect(e.status).toBe(409);
    }
  });

  test("rejects reserved table names", () => {
    try {
      updateCollection(pool, "_collections", [{ name: "x", type: "TEXT" }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot modify reserved table");
      expect(e.status).toBe(403);
    }
  });

  test("rejects empty columns array", () => {
    createCollection(pool, "nonempty", [{ name: "x", type: "TEXT" }]);

    try {
      updateCollection(pool, "nonempty", []);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("At least one column is required");
      expect(e.status).toBe(400);
    }
  });

  test("rejects invalid column types on update", () => {
    createCollection(pool, "valid_first", [{ name: "x", type: "TEXT" }]);

    try {
      updateCollection(pool, "valid_first", [{ name: "y", type: "UNKNOWN" as never }]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Invalid column type");
      expect(e.status).toBe(400);
    }
  });

  test("column addition is persisted and visible in getCollection", () => {
    createCollection(pool, "persist_test", [{ name: "a", type: "TEXT" }]);

    updateCollection(pool, "persist_test", [{ name: "b", type: "INTEGER" }]);

    const info = getCollection(pool, "persist_test");
    const colNames = info.schema.map((c) => c.name);
    expect(colNames).toContain("a");
    expect(colNames).toContain("b");
  });
});

// ---------------------------------------------------------------------------
// deleteCollection
// ---------------------------------------------------------------------------

describe("deleteCollection", () => {
  test("deletes an existing collection", () => {
    createCollection(pool, "temp", [{ name: "x", type: "TEXT" }]);

    expect(listCollections(pool).length).toBe(1);

    deleteCollection(pool, "temp");

    expect(listCollections(pool).length).toBe(0);
  });

  test("returns 404 for non-existent collection", () => {
    try {
      deleteCollection(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("not found");
      expect(e.status).toBe(404);
    }
  });

  test("rejects deletion of reserved/system tables", () => {
    try {
      deleteCollection(pool, "_collections");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot delete reserved table");
      expect(e.status).toBe(403);
    }

    try {
      deleteCollection(pool, "_migrations");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("Cannot delete reserved table");
      expect(e.status).toBe(403);
    }
  });

  test("idempotent — deleting same collection twice fails with 404", () => {
    createCollection(pool, "one_shot", [{ name: "x", type: "TEXT" }]);

    deleteCollection(pool, "one_shot");

    try {
      deleteCollection(pool, "one_shot");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string; status?: number };
      expect(e.message).toContain("not found");
      expect(e.status).toBe(404);
    }
  });

  test("deleted collection is removed from _collections metadata", () => {
    createCollection(pool, "meta_test", [{ name: "x", type: "TEXT" }]);

    const db = pool.read();
    const metaBefore = db.query("SELECT 1 FROM _collections WHERE name=?").get("meta_test");
    expect(metaBefore).not.toBeNull();

    deleteCollection(pool, "meta_test");

    const metaAfter = db.query("SELECT 1 FROM _collections WHERE name=?").get("meta_test");
    expect(metaAfter).toBeNull();
  });

  test("deleting a collection also removes its table from sqlite_master", () => {
    createCollection(pool, "drop_me", [{ name: "x", type: "TEXT" }]);

    deleteCollection(pool, "drop_me");

    const db = pool.read();
    const row = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get("drop_me");
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: full lifecycle
// ---------------------------------------------------------------------------

describe("Collection lifecycle", () => {
  test("create → read → update → delete", () => {
    const created = createCollection(pool, "lifecycle", [
      { name: "title", type: "TEXT" },
      { name: "views", type: "INTEGER", default: 0 },
    ]);
    expect(created.name).toBe("lifecycle");
    expect(created.recordCount).toBe(0);

    const list = listCollections(pool);
    expect(list.find((c) => c.name === "lifecycle")).toBeDefined();

    const info = getCollection(pool, "lifecycle");
    expect(info.schema).toHaveLength(2);

    const updated = updateCollection(pool, "lifecycle", [
      { name: "description", type: "TEXT" },
    ]);
    expect(updated.schema).toHaveLength(3);

    const info2 = getCollection(pool, "lifecycle");
    expect(info2.schema).toHaveLength(3);

    deleteCollection(pool, "lifecycle");

    expect(listCollections(pool).find((c) => c.name === "lifecycle")).toBeUndefined();
    try {
      getCollection(pool, "lifecycle");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-database isolation: different apps have separate collections
// ---------------------------------------------------------------------------

describe("Multi-database isolation", () => {
  test("collections in one database do not appear in another", () => {
    // Create a second application
    manager.createDatabase("secondapp");
    const pool2 = manager.get("secondapp");

    // Create collection in first app
    createCollection(pool, "only_in_testapp", [{ name: "x", type: "TEXT" }]);

    // Verify it's visible in testapp
    expect(listCollections(pool).length).toBeGreaterThanOrEqual(1);

    // Verify it's NOT visible in secondapp
    expect(listCollections(pool2)).toEqual([]);

    // Verify getCollection fails with 404 in secondapp
    try {
      getCollection(pool2, "only_in_testapp");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }

    // Cleanup
    manager.deleteDatabase("secondapp");
  });
});