/**
 * Tests for the views management module.
 *
 * @module tests/admin/views
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../../src/db/manager";
import { createView, listViews, getView, queryView, dropView } from "../../src/admin/views";
import { createCollection, listCollections } from "../../src/collections";
import { createRecord, listRecords } from "../../src/records";

const TEST_DATA_DIR = "/tmp/boltstore_test_views";
const TEST_APP = "viewstestapp";

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
  manager.createDatabase(TEST_APP);
  pool = manager.get(TEST_APP);
});

afterAll(() => cleanup());

beforeEach(() => {
  // Reset: drop all user tables, views, and _collections metadata
  const db = pool.write();
  const rows = db
    .query("SELECT name, type FROM sqlite_master WHERE (type='table' OR type='view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_%' ESCAPE '\\'")
    .all() as { name: string; type: string }[];
  for (const row of rows) {
    try {
      if (row.type === "view") db.run(`DROP VIEW IF EXISTS "${row.name}"`);
      else db.run(`DROP TABLE IF EXISTS "${row.name}"`);
    } catch {}
  }
  // Clean _collections metadata
  try { db.run("DELETE FROM _collections WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_%' ESCAPE '\\'"); } catch {}
});

// ---------------------------------------------------------------------------
// createView
// ---------------------------------------------------------------------------

describe("createView", () => {
  test("creates a simple SELECT view", () => {
    createCollection(pool, "items", [
      { name: "label", type: "TEXT" },
      { name: "price", type: "REAL" },
    ]);
    createRecord(pool, "items", { label: "Widget", price: 9.99 });
    createRecord(pool, "items", { label: "Gadget", price: 19.99 });

    const result = createView(pool, "expensive_items", "SELECT * FROM items WHERE price > 10");

    expect(result.name).toBe("expensive_items");
    expect(result.sql).toContain("SELECT * FROM items WHERE price > 10");

    // Verify data through the view
    const viewData = queryView(pool, "expensive_items");
    expect(viewData).toHaveLength(1);
    expect(viewData[0].label).toBe("Gadget");
  });

  test("creates a view with JOIN", () => {
    createCollection(pool, "users", [{ name: "name", type: "TEXT" }]);
    createCollection(pool, "posts", [
      { name: "title", type: "TEXT" },
      { name: "user_id", type: "TEXT" },
    ]);

    const user = createRecord(pool, "users", { name: "Alice" });
    createRecord(pool, "posts", { title: "Hello", user_id: user.id });

    createView(pool, "user_posts",
      `SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id`);

    const viewData = queryView(pool, "user_posts");
    expect(viewData).toHaveLength(1);
    expect(viewData[0].name).toBe("Alice");
    expect(viewData[0].title).toBe("Hello");
  });

  test("creates a view with WITH (CTE)", () => {
    createCollection(pool, "nums", [{ name: "value", type: "INTEGER" }]);
    createRecord(pool, "nums", { value: 1 });
    createRecord(pool, "nums", { value: 2 });
    createRecord(pool, "nums", { value: 3 });

    createView(pool, "big_nums",
      "WITH filtered AS (SELECT * FROM nums WHERE value > 1) SELECT * FROM filtered");

    const viewData = queryView(pool, "big_nums");
    expect(viewData).toHaveLength(2);
  });

  test("rejects non-SELECT SQL", () => {
    try {
      createView(pool, "bad_view", "INSERT INTO items VALUES (1, 'test')");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects SQL containing DROP", () => {
    try {
      createView(pool, "malicious", "SELECT * FROM sqlite_master; DROP TABLE items");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects SQL containing DELETE", () => {
    try {
      createView(pool, "malicious", "SELECT * FROM items; DELETE FROM items WHERE 1=1");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects SQL containing UPDATE", () => {
    try {
      createView(pool, "malicious", "SELECT * FROM items; UPDATE items SET name='hacked'");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects reserved view name", () => {
    try {
      createView(pool, "_collections", "SELECT 1");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("rejects invalid view name", () => {
    try {
      createView(pool, "bad name!", "SELECT 1");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid view name");
    }
  });

  test("rejects empty SQL", () => {
    try {
      createView(pool, "empty_view", "");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("returns 409 for duplicate view name", () => {
    createView(pool, "dup_view", "SELECT 1");
    try {
      createView(pool, "dup_view", "SELECT 2");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// listViews
// ---------------------------------------------------------------------------

describe("listViews", () => {
  test("returns empty array when no views exist", () => {
    const views = listViews(pool);
    expect(views).toEqual([]);
  });

  test("lists all views", () => {
    createCollection(pool, "t1", [{ name: "x", type: "TEXT" }]);
    createCollection(pool, "t2", [{ name: "x", type: "TEXT" }]);
    createView(pool, "v1", "SELECT * FROM t1");
    createView(pool, "v2", "SELECT * FROM t2");

    const views = listViews(pool);
    expect(views).toHaveLength(2);
    const names = views.map((v) => v.name).sort();
    expect(names).toEqual(["v1", "v2"]);
  });

  test("each view entry has name and sql", () => {
    createCollection(pool, "t", [{ name: "x", type: "TEXT" }]);
    createView(pool, "my_view", "SELECT * FROM t");

    const views = listViews(pool);
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("my_view");
    expect(views[0].sql).toContain("SELECT * FROM t");
  });

  test("excludes SQLite internal views", () => {
    createCollection(pool, "t", [{ name: "x", type: "TEXT" }]);
    createView(pool, "user_view", "SELECT * FROM t");

    const views = listViews(pool);
    const names = views.map((v) => v.name);
    expect(names).not.toContain("sqlite_master");
  });
});

// ---------------------------------------------------------------------------
// getView
// ---------------------------------------------------------------------------

describe("getView", () => {
  test("returns view metadata", () => {
    createCollection(pool, "t", [{ name: "x", type: "TEXT" }]);
    createView(pool, "v", "SELECT * FROM t");

    const info = getView(pool, "v");
    expect(info.name).toBe("v");
    expect(info.sql).toContain("SELECT * FROM t");
  });

  test("returns 404 for non-existent view", () => {
    try {
      getView(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// queryView
// ---------------------------------------------------------------------------

describe("queryView", () => {
  test("queries all rows from a view", () => {
    createCollection(pool, "source", [
      { name: "name", type: "TEXT" },
      { name: "score", type: "INTEGER" },
    ]);
    createRecord(pool, "source", { name: "Alpha", score: 100 });
    createRecord(pool, "source", { name: "Beta", score: 200 });

    createView(pool, "high_scorers", "SELECT * FROM source WHERE score > 50");

    const data = queryView(pool, "high_scorers");
    expect(data).toHaveLength(2);
    const names = data.map((r) => r.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });

  test("filters with query string params", () => {
    createCollection(pool, "src", [
      { name: "category", type: "TEXT" },
      { name: "value", type: "INTEGER" },
    ]);
    createRecord(pool, "src", { category: "A", value: 10 });
    createRecord(pool, "src", { category: "B", value: 20 });

    createView(pool, "filtered", "SELECT * FROM src");

    const data = queryView(pool, "filtered", { filter: { category: "A" } });
    expect(data).toHaveLength(1);
    expect(data[0].value).toBe(10);
  });

  test("sorts results", () => {
    createCollection(pool, "src", [{ name: "n", type: "INTEGER" }]);
    createRecord(pool, "src", { n: 3 });
    createRecord(pool, "src", { n: 1 });
    createRecord(pool, "src", { n: 2 });

    createView(pool, "sorted", "SELECT * FROM src");

    const data = queryView(pool, "sorted", { sort: "n", direction: "asc" });
    expect(data[0].n).toBe(1);
    expect(data[1].n).toBe(2);
    expect(data[2].n).toBe(3);
  });

  test("paginates with limit", () => {
    createCollection(pool, "src", [{ name: "n", type: "INTEGER" }]);
    for (let i = 1; i <= 10; i++) createRecord(pool, "src", { n: i });

    createView(pool, "paginated", "SELECT * FROM src");

    const data = queryView(pool, "paginated", { limit: 3 });
    expect(data).toHaveLength(3);
  });

  test("returns 404 for non-existent view", () => {
    try {
      queryView(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// dropView
// ---------------------------------------------------------------------------

describe("dropView", () => {
  test("drops an existing view", () => {
    createCollection(pool, "t", [{ name: "x", type: "TEXT" }]);
    createView(pool, "to_drop", "SELECT * FROM t");

    expect(listViews(pool)).toHaveLength(1);

    dropView(pool, "to_drop");

    expect(listViews(pool)).toHaveLength(0);
  });

  test("returns 404 for non-existent view", () => {
    try {
      dropView(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("rejects dropping reserved views", () => {
    try {
      dropView(pool, "_collections");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("idempotent — dropping same view twice fails", () => {
    createCollection(pool, "t", [{ name: "x", type: "TEXT" }]);
    createView(pool, "once", "SELECT * FROM t");

    dropView(pool, "once");

    try {
      dropView(pool, "once");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: full lifecycle
// ---------------------------------------------------------------------------

describe("View lifecycle", () => {
  test("create → list → get → query → drop", () => {
    createCollection(pool, "products", [
      { name: "name", type: "TEXT" },
      { name: "price", type: "REAL" },
    ]);
    createRecord(pool, "products", { name: "A", price: 10 });
    createRecord(pool, "products", { name: "B", price: 20 });

    // Create
    const created = createView(pool, "cheap_products", "SELECT * FROM products WHERE price < 15");
    expect(created.name).toBe("cheap_products");

    // List
    const views = listViews(pool);
    expect(views.find((v) => v.name === "cheap_products")).toBeDefined();

    // Get
    const info = getView(pool, "cheap_products");
    expect(info.sql).toContain("price < 15");

    // Query
    const data = queryView(pool, "cheap_products");
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("A");

    // Drop
    dropView(pool, "cheap_products");
    expect(listViews(pool).find((v) => v.name === "cheap_products")).toBeUndefined();
  });
});