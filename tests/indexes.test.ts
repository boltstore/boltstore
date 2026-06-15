/**
 * Tests for index management.
 *
 * @module tests/indexes
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection } from "../src/collections";
import { createIndex, listIndexes, getIndex, dropIndex } from "../src/indexes";
import type { IndexInfo } from "../src/indexes";

const TEST_DATA_DIR = "/tmp/boltstore_test_indexes";
const TEST_APP = "indexapp";

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

  createCollection(pool, "users", [
    { name: "name", type: "TEXT" },
    { name: "email", type: "TEXT" },
    { name: "age", type: "INTEGER" },
    { name: "city", type: "TEXT" },
  ]);
});

afterAll(() => cleanup());

describe("createIndex", () => {
  test("creates a simple index", () => {
    const result = createIndex(pool, "users", "idx_users_name", {
      columns: ["name"],
    });
    expect(result.name).toBe("idx_users_name");
    expect(result.unique).toBe(false);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe("name");
    expect(result.sql).toContain("CREATE INDEX");
    expect(result.sql).toContain("ON \"users\"");
  });

  test("creates a unique index", () => {
    const result = createIndex(pool, "users", "idx_users_email_unique", {
      columns: ["email"],
      unique: true,
    });
    expect(result.unique).toBe(true);
    expect(result.sql).toContain("CREATE UNIQUE INDEX");
  });

  test("creates a composite (multi-field) index", () => {
    const result = createIndex(pool, "users", "idx_users_name_age", {
      columns: ["name", "age"],
    });
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].name).toBe("name");
    expect(result.columns[1].name).toBe("age");
  });

  test("rejects empty columns array (400)", () => {
    try {
      createIndex(pool, "users", "bad", { columns: [] });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects duplicate index name (409)", () => {
    createIndex(pool, "users", "dup_idx", { columns: ["city"] });
    try {
      createIndex(pool, "users", "dup_idx", { columns: ["age"] });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(409);
    }
  });

  test("rejects non-existent collection (404)", () => {
    try {
      createIndex(pool, "ghost", "idx_ghost", { columns: ["x"] });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

describe("listIndexes", () => {
  test("lists user-created indexes", () => {
    createIndex(pool, "users", "idx_a", { columns: ["name"] });
    createIndex(pool, "users", "idx_b", { columns: ["email"] });

    const result = listIndexes(pool, "users");
    expect(result.length).toBeGreaterThanOrEqual(2);
    const names = result.map((i) => i.name);
    expect(names).toContain("idx_a");
    expect(names).toContain("idx_b");
  });

  test("excludes system auto-indexes", () => {
    const result = listIndexes(pool, "users");
    const names = result.map((i) => i.name);
    // sqlite_autoindex_* should not appear
    expect(names.every((n) => !n.startsWith("sqlite_autoindex_"))).toBe(true);
  });

  test("returns 404 for non-existent collection", () => {
    try {
      listIndexes(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

describe("getIndex", () => {
  test("returns full index details", () => {
    createIndex(pool, "users", "detail_idx", {
      columns: ["name", "city"],
      unique: true,
    });

    const result = getIndex(pool, "users", "detail_idx");
    expect(result.name).toBe("detail_idx");
    expect(result.unique).toBe(true);
    expect(result.columns).toHaveLength(2);
    expect(result.sql).toBeDefined();
  });

  test("returns 404 for non-existent index", () => {
    try {
      getIndex(pool, "users", "nope_idx");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

describe("dropIndex", () => {
  test("drops an existing index", () => {
    createIndex(pool, "users", "to_drop", { columns: ["age"] });

    expect(listIndexes(pool, "users").find((i) => i.name === "to_drop")).toBeDefined();

    dropIndex(pool, "users", "to_drop");

    expect(listIndexes(pool, "users").find((i) => i.name === "to_drop")).toBeUndefined();
  });

  test("returns 404 for non-existent index", () => {
    try {
      dropIndex(pool, "users", "nope_idx");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("rejects dropping system indexes (403)", () => {
    try {
      dropIndex(pool, "users", "sqlite_autoindex_users_1");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });
});
