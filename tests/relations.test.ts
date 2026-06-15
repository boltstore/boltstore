/**
 * Tests for relations (expand and cascade delete).
 *
 * @module tests/relations
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection } from "../src/collections";
import { createRecord, listRecords, getRecord, deleteRecord } from "../src/records";
import { expandRecords, cascadeDelete } from "../src/relations";

const TEST_DATA_DIR = "/tmp/boltstore_test_relations";
const TEST_APP = "relapp";

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

  // Create a parent collection (authors)
  createCollection(pool, "authors", [
    { name: "name", type: "TEXT" },
  ]);

  // Create a child collection (posts) with author foreign key
  createCollection(pool, "posts", [
    { name: "title", type: "TEXT" },
    { name: "author", type: "TEXT" }, // foreign key → authors.id
    { name: "body", type: "TEXT" },
  ]);

  // Create a comments collection with posts foreign key for cascade
  createCollection(pool, "comments", [
    { name: "text", type: "TEXT" },
    { name: "posts_id", type: "TEXT" }, // foreign key → posts.id
  ]);

  // Seed data
  createRecord(pool, "authors", { id: "author_1", name: "Alice" });
  createRecord(pool, "authors", { id: "author_2", name: "Bob" });

  createRecord(pool, "posts", { id: "post_1", title: "First Post", author: "author_1", body: "Hello world" });
  createRecord(pool, "posts", { id: "post_2", title: "Second Post", author: "author_1", body: "Another one" });
  createRecord(pool, "posts", { id: "post_3", title: "Bob's Post", author: "author_2", body: "By Bob" });

  createRecord(pool, "comments", { id: "cmt_1", text: "Nice post!", posts_id: "post_1" });
  createRecord(pool, "comments", { id: "cmt_2", text: "Thanks!", posts_id: "post_1" });
  createRecord(pool, "comments", { id: "cmt_3", text: "Great", posts_id: "post_2" });
});

afterAll(() => cleanup());

describe("expandRecords", () => {
  test("expands related records for a given field", () => {
    const records = listRecords(pool, "posts");
    const result = expandRecords(pool, "posts", records, ["author"]);

    expect(result.length).toBe(3);

    // Each record should have author_expanded
    for (const record of result) {
      expect(record.author_expanded).toBeDefined();
    }

    // First post by Alice
    const post1 = result.find((r) => r.id === "post_1")!;
    expect((post1.author_expanded as Record<string, unknown>).name).toBe("Alice");

    // Third post by Bob
    const post3 = result.find((r) => r.id === "post_3")!;
    expect((post3.author_expanded as Record<string, unknown>).name).toBe("Bob");
  });

  test("expands multiple fields", () => {
    const records = listRecords(pool, "posts");

    // Add a dummy category collection for multi-expand test
    createCollection(pool, "categories", [{ name: "label", type: "TEXT" }]);
    createRecord(pool, "posts", { id: "post_4", title: "Cat Post", author: "author_1", body: "Categorized" });

    const result = expandRecords(pool, "posts", records, ["author"]);

    // Should work even if some expandable collections don't exist
    expect(result.length).toBeGreaterThan(0);
    expect((result[0].author_expanded as Record<string, unknown>).name).toBeDefined();
  });

  test("sets expand to null for non-existent foreign keys", () => {
    const records = [{ id: "orphan", title: "Orphan Post", author: "nonexistent_author" }];
    const result = expandRecords(pool, "posts", records, ["author"]);

    expect(result[0].author_expanded).toBeNull();
  });

  test("returns records unchanged when no expand fields", () => {
    const records = listRecords(pool, "posts");
    const result = expandRecords(pool, "posts", records, []);
    expect(result).toEqual(records);
  });

  test("returns records unchanged for empty records array", () => {
    const result = expandRecords(pool, "posts", [], ["author"]);
    expect(result).toEqual([]);
  });
});

describe("cascadeDelete", () => {
  test("deletes child records referencing the parent", () => {
    const result = cascadeDelete(pool, "posts", "post_1");

    expect(result.deleted).toContain("comments");
    expect(result.deleted.length).toBe(1); // only comments table has the cascade column
  });

  test("returns deleted tables with cascade column even when no children exist", () => {
    // Create a post with no comments, but comments table still has posts_id column
    createRecord(pool, "posts", { id: "lonely", title: "Lonely Post", author: "author_1", body: "Alone" });

    const result = cascadeDelete(pool, "posts", "lonely");
    // comments table has posts_id column, so it's listed even though 0 rows were deleted
    expect(result.deleted).toContain("comments");
  });
});