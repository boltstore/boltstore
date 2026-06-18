/**
 * Tests for the records CRUD module.
 *
 * @module tests/records
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import {
  createCollection,
} from "../src/collections";
import {
  createRecord,
  listRecords,
  getRecord,
  updateRecord,
  deleteRecord,
  countRecords,
  distinctValues,
  batchRecords,
} from "../src/records";

const TEST_DATA_DIR = "/tmp/boltstore_test_records";
const TEST_APP = "recordapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;

function cleanup() {
  try {
    if (manager) manager.close();
  } catch {
    // ignore
  }
  try {
    Bun.spawnSync(["rm", "-rf", TEST_DATA_DIR]);
  } catch {
    // ignore
  }
}

beforeAll(() => {
  cleanup();
  Bun.spawnSync(["mkdir", "-p", TEST_DATA_DIR]);
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  manager.createDatabase(TEST_APP);
  pool = manager.get(TEST_APP);

  // Create a test collection
  createCollection(pool, "todos", [
    { name: "title", type: "TEXT" },
    { name: "done", type: "BOOLEAN", default: false },
    { name: "priority", type: "INTEGER", default: 0 },
  ]);
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  // Clear all records between tests
  pool.write().run(`DELETE FROM "todos"`);
});

// ---------------------------------------------------------------------------
// createRecord
// ---------------------------------------------------------------------------

describe("createRecord", () => {
  test("creates a record with auto-generated id", () => {
    const result = createRecord(pool, "todos", { title: "Buy milk" });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.id).toMatch(/^rec_/);
    expect(result.title).toBe("Buy milk");
    expect(result.done).toBe(0); // BOOLEAN → INTEGER in SQLite
    expect(result.priority).toBe(0);
    expect(result.created_at).toBeDefined();
    expect(result.updated_at).toBeDefined();
  });

  test("returns 404 for non-existent collection", () => {
    try {
      createRecord(pool, "ghost", { x: 1 });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("allows specifying a custom id (upsert)", () => {
    const result = createRecord(pool, "todos", {
      id: "custom-1",
      title: "Custom ID task",
    });

    expect(result.id).toBe("custom-1");
    expect(result.title).toBe("Custom ID task");
  });

  test("upsert — same id overwrites existing record", () => {
    const first = createRecord(pool, "todos", {
      id: "upsert-1",
      title: "Original title",
    });

    const second = createRecord(pool, "todos", {
      id: "upsert-1",
      title: "Updated title",
    });

    expect(second.id).toBe("upsert-1");
    expect(second.title).toBe("Updated title");

    // Verify only one record exists with this id
    const count = countRecords(pool, "todos");
    expect(count).toBe(1);
  });

  test("ignores unknown columns (system columns auto-generated)", () => {
    const result = createRecord(pool, "todos", { title: "Test" });

    // System columns exist
    expect(result.id).toBeDefined();
    expect(result.created_at).toBeDefined();
    expect(result.updated_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// listRecords
// ---------------------------------------------------------------------------

describe("listRecords", () => {
  test("returns empty array when no records exist", () => {
    const result = listRecords(pool, "todos");
    expect(result).toEqual([]);
  });

  test("lists all records with default sorting by created_at DESC", () => {
    createRecord(pool, "todos", { title: "A" });
    Bun.sleepSync(2); // ensure distinct created_at timestamps
    createRecord(pool, "todos", { title: "B" });
    Bun.sleepSync(2);
    createRecord(pool, "todos", { title: "C" });

    const result = listRecords(pool, "todos");
    expect(result.length).toBe(3);
    // Most recent first (DESC)
    expect(result[0].title).toBe("C");
  });

  test("sorts by custom field ascending", () => {
    createRecord(pool, "todos", { title: "Z", priority: 3 });
    createRecord(pool, "todos", { title: "A", priority: 1 });
    createRecord(pool, "todos", { title: "M", priority: 2 });

    const result = listRecords(pool, "todos", {
      sort: "priority",
      direction: "asc",
    });
    expect(result[0].priority).toBe(1);
    expect(result[1].priority).toBe(2);
    expect(result[2].priority).toBe(3);
  });

  test("filters by field value", () => {
    createRecord(pool, "todos", { title: "Buy milk", done: true });
    createRecord(pool, "todos", { title: "Buy eggs", done: false });
    createRecord(pool, "todos", { title: "Buy bread", done: false });

    const result = listRecords(pool, "todos", {
      filter: { done: 1 }, // BOOLEAN true → 1
    });
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Buy milk");
  });

  test("paginates with limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      createRecord(pool, "todos", { title: `Task ${i}` });
    }

    const page1 = listRecords(pool, "todos", { limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = listRecords(pool, "todos", { limit: 2, offset: 2 });
    expect(page2.length).toBe(2);

    const page3 = listRecords(pool, "todos", { limit: 2, offset: 4 });
    expect(page3.length).toBe(1);
  });

  test("returns 404 for non-existent collection", () => {
    try {
      listRecords(pool, "ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// getRecord
// ---------------------------------------------------------------------------

describe("getRecord", () => {
  test("returns a single record by id", () => {
    const created = createRecord(pool, "todos", { title: "Unique task" });

    const result = getRecord(pool, "todos", created.id as string);
    expect(result.title).toBe("Unique task");
    expect(result.id).toBe(created.id);
  });

  test("returns 404 for non-existent record", () => {
    try {
      getRecord(pool, "todos", "rec_nonexistent_id");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("returns 404 for non-existent collection", () => {
    try {
      getRecord(pool, "ghost", "rec_123");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// updateRecord
// ---------------------------------------------------------------------------

describe("updateRecord", () => {
  test("updates specific fields on a record", () => {
    const created = createRecord(pool, "todos", { title: "Old title" });

    const updated = updateRecord(pool, "todos", created.id as string, {
      title: "New title",
      done: true,
    });

    expect(updated.title).toBe("New title");
    expect(updated.done).toBe(1); // BOOLEAN true → 1
    // Non-updated fields preserved
    expect(updated.priority).toBe(0);
    // updated_at should be bumped (or at least be a valid date string)
    expect(updated.updated_at).toBeTruthy();
  });

  test("cannot change immutable fields (id, created_at)", () => {
    const created = createRecord(pool, "todos", { title: "Immutable test" });

    const updated = updateRecord(pool, "todos", created.id as string, {
      id: "hacked-id",
      created_at: "2020-01-01",
      title: "New title",
    });

    // id and created_at should be unchanged
    expect(updated.id).toBe(created.id);
    expect(updated.created_at).toBe(created.created_at);
    // mutable field should change
    expect(updated.title).toBe("New title");
  });

  test("returns 404 for non-existent record", () => {
    try {
      updateRecord(pool, "todos", "rec_nonexistent", { title: "x" });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("returns 400 when no valid fields to update", () => {
    const created = createRecord(pool, "todos", { title: "Test" });

    try {
      updateRecord(pool, "todos", created.id as string, {});
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("silently ignores unknown columns", () => {
    const created = createRecord(pool, "todos", { title: "Test" });

    const updated = updateRecord(pool, "todos", created.id as string, {
      title: "Changed",
      nonexistent_field: "should be ignored",
    });

    expect(updated.title).toBe("Changed");
    expect((updated as Record<string, unknown>).nonexistent_field).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteRecord
// ---------------------------------------------------------------------------

describe("deleteRecord", () => {
  test("deletes a record", () => {
    const created = createRecord(pool, "todos", { title: "Delete me" });

    expect(countRecords(pool, "todos")).toBe(1);

    deleteRecord(pool, "todos", created.id as string);

    expect(countRecords(pool, "todos")).toBe(0);
  });

  test("returns 404 for non-existent record", () => {
    try {
      deleteRecord(pool, "todos", "rec_nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("returns 404 for non-existent collection", () => {
    try {
      deleteRecord(pool, "ghost", "rec_123");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// countRecords
// ---------------------------------------------------------------------------

describe("countRecords", () => {
  test("returns 0 for empty collection", () => {
    expect(countRecords(pool, "todos")).toBe(0);
  });

  test("counts all records", () => {
    for (let i = 0; i < 5; i++) {
      createRecord(pool, "todos", { title: `Task ${i}` });
    }
    expect(countRecords(pool, "todos")).toBe(5);
  });

  test("counts with filter", () => {
    createRecord(pool, "todos", { title: "Done", done: true });
    createRecord(pool, "todos", { title: "Pending", done: false });

    expect(countRecords(pool, "todos", { done: 1 })).toBe(1);
    expect(countRecords(pool, "todos", { done: 0 })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// distinctValues
// ---------------------------------------------------------------------------

describe("distinctValues", () => {
  test("returns distinct values for a field", () => {
    createRecord(pool, "todos", { title: "A", priority: 1 });
    createRecord(pool, "todos", { title: "B", priority: 2 });
    createRecord(pool, "todos", { title: "C", priority: 1 });
    createRecord(pool, "todos", { title: "D", priority: 3 });

    const values = distinctValues(pool, "todos", "priority");
    expect(values).toEqual([1, 2, 3]);
  });

  test("returns empty array for empty collection", () => {
    const values = distinctValues(pool, "todos", "priority");
    expect(values).toEqual([]);
  });

  test("returns single value when all records have same field", () => {
    createRecord(pool, "todos", { title: "A", priority: 5 });
    createRecord(pool, "todos", { title: "B", priority: 5 });

    const values = distinctValues(pool, "todos", "priority");
    expect(values).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// batchRecords
// ---------------------------------------------------------------------------

describe("batchRecords", () => {
  test("creates multiple records in a single transaction", () => {
    const result = batchRecords(pool, "todos", [
      { action: "create", data: { title: "Batch A" } },
      { action: "create", data: { title: "Batch B" } },
      { action: "create", data: { title: "Batch C" } },
    ]);

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
    expect(countRecords(pool, "todos")).toBe(3);
  });

  test("handles mixed create, update, and delete operations", () => {
    const a = createRecord(pool, "todos", { title: "To update" });
    const b = createRecord(pool, "todos", { title: "To delete" });

    expect(countRecords(pool, "todos")).toBe(2);

    const result = batchRecords(pool, "todos", [
      { action: "create", data: { title: "New one" } },
      { action: "update", id: a.id as string, data: { title: "Updated" } },
      { action: "delete", id: b.id as string },
    ]);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.deleted).toBe(1);
    expect(countRecords(pool, "todos")).toBe(2);

    // Verify the update
    const updated = getRecord(pool, "todos", a.id as string);
    expect(updated.title).toBe("Updated");

    // Verify the delete
    try {
      getRecord(pool, "todos", b.id as string);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("rejects invalid action", () => {
    try {
      batchRecords(pool, "todos", [
        { action: "invalid" as never, data: { title: "x" } },
      ]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects create without data", () => {
    try {
      batchRecords(pool, "todos", [{ action: "create" } as never]);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("all-or-nothing — transaction rolls back on error", () => {
    const initialCount = countRecords(pool, "todos");

    try {
      batchRecords(pool, "todos", [
        { action: "create", data: { title: "Good" } },
        { action: "update", id: "rec_nonexistent", data: { title: "Bad" } },
      ]);
      expect.unreachable("Should have thrown");
    } catch {
      // Expected — update of nonexistent should fail
    }

    // Transaction should have rolled back — no records created
    expect(countRecords(pool, "todos")).toBe(initialCount);
  });
});

// ---------------------------------------------------------------------------
// Integration: full record lifecycle
// ---------------------------------------------------------------------------

describe("Record lifecycle", () => {
  test("create → read → update → delete", () => {
    // Create
    const created = createRecord(pool, "todos", {
      title: "Lifecycle test",
      priority: 10,
    });
    expect(created.title).toBe("Lifecycle test");
    expect(created.priority).toBe(10);

    // Read
    const read = getRecord(pool, "todos", created.id as string);
    expect(read.title).toBe("Lifecycle test");

    // List
    const list = listRecords(pool, "todos", { filter: { priority: 10 } });
    expect(list.length).toBe(1);

    // Update
    const updated = updateRecord(pool, "todos", created.id as string, {
      title: "Updated lifecycle",
      done: true,
    });
    expect(updated.title).toBe("Updated lifecycle");
    expect(updated.done).toBe(1);
    expect(updated.priority).toBe(10); // unchanged

    // Count
    expect(countRecords(pool, "todos")).toBe(1);

    // Delete
    deleteRecord(pool, "todos", created.id as string);
    expect(countRecords(pool, "todos")).toBe(0);

    // Verify gone
    try {
      getRecord(pool, "todos", created.id as string);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});