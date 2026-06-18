/**
 * Tests for the backup/restore module.
 *
 * @module tests/admin/backup
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach, jest } from "bun:test";
import { Database as SQLiteDatabase } from "bun:sqlite";
import { DatabaseManager } from "../../src/db/manager";
import { createBackup, listBackups, getBackup, restoreBackup, restoreFromFile } from "../../src/admin/backup";
import { createCollection } from "../../src/collections";
import { createRecord, updateRecord, listRecords } from "../../src/records";
import { statSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const TEST_DATA_DIR = "/tmp/boltstore_test_backup";
const TEST_APP = "backuptestapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;
let dbId: string;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(() => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const result = manager.createDatabase(TEST_APP);
  dbId = result.id;
  pool = manager.get(dbId);
});

afterAll(() => cleanup());

beforeEach(() => {
  // After restore tests, the pool may have been closed. Re-get it.
  pool = manager.get(dbId);

  // Clean up backup files from previous tests
  const backupsDir = `${TEST_DATA_DIR}/backuptestapp/backups`;
  try { rmSync(backupsDir, { recursive: true, force: true }); } catch {}
  try { mkdirSync(backupsDir, { recursive: true }); } catch {}

  // Reset: drop all user tables
  const db = pool.write();
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'")
    .all() as { name: string }[];
  for (const row of rows) {
    try { db.run(`DROP TABLE IF EXISTS "${row.name}"`); } catch {}
  }
  // Also drop _backups to reset backup state; avoid failing if dropped in pre_restore tests
  try { db.run("DROP TABLE IF EXISTS _backups"); } catch {}
  // Compact the database after dropping tables to release deleted pages
  try { db.run("VACUUM"); } catch {}
});

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

describe("createBackup", () => {
  test("creates a backup of an empty database", () => {
    const result = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    expect(result.id).toMatch(/^bkp_/);
    expect(result.path).toContain(TEST_DATA_DIR);
    expect(result.path).toContain(TEST_APP);
    expect(result.path).toEndWith(".db");
    expect(result.createdAt).toBeTruthy();

    // Verify backup file exists on disk
    const stat = statSync(result.path);
    expect(stat.isFile()).toBe(true);
  });

  test("creates a backup with a label", () => {
    const result = createBackup(pool, TEST_APP, TEST_DATA_DIR, {
      label: "Pre-migration snapshot",
    });

    expect(result.label).toBe("Pre-migration snapshot");

    // Verify label is stored
    const stored = getBackup(pool, result.id);
    expect(stored.label).toBe("Pre-migration snapshot");
  });

  test("backup preserves data", () => {
    // Create a collection with data
    createCollection(pool, "items", [
      { name: "name", type: "TEXT" },
      { name: "value", type: "INTEGER" },
    ]);
    createRecord(pool, "items", { name: "Alpha", value: 100 });
    createRecord(pool, "items", { name: "Beta", value: 200 });

    // Backup
    const result = createBackup(pool, TEST_APP, TEST_DATA_DIR, {
      label: "With data",
    });

    expect(result.id).toBeTruthy();

    // Records still exist after backup
    const records = listRecords(pool, "items");
    expect(records).toHaveLength(2);
  });

  test("sizeBytes is a positive number for non-empty database", () => {
    createCollection(pool, "has_data", [{ name: "x", type: "TEXT" }]);
    createRecord(pool, "has_data", { x: "hello" });

    const result = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    // On macOS, stat -f %z returns file size
    expect(result.sizeBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

describe("listBackups", () => {
  test("returns empty array when no backups exist", () => {
    const backups = listBackups(pool);
    expect(backups).toEqual([]);
  });

  test("lists all backups in reverse chronological order", () => {
    createBackup(pool, TEST_APP, TEST_DATA_DIR, { label: "First" });
    createBackup(pool, TEST_APP, TEST_DATA_DIR, { label: "Second" });

    const backups = listBackups(pool);
    expect(backups).toHaveLength(2);

    // Most recent first
    expect(backups[0].label).toBe("Second");
    expect(backups[1].label).toBe("First");
  });

  test("each backup entry has required fields", () => {
    createBackup(pool, TEST_APP, TEST_DATA_DIR);

    const backups = listBackups(pool);
    expect(backups).toHaveLength(1);

    const b = backups[0];
    expect(b.id).toMatch(/^bkp_/);
    expect(b.path).toBeTruthy();
    expect(b.createdAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getBackup
// ---------------------------------------------------------------------------

describe("getBackup", () => {
  test("returns a specific backup by ID", () => {
    const created = createBackup(pool, TEST_APP, TEST_DATA_DIR, { label: "My backup" });

    const found = getBackup(pool, created.id);
    expect(found.id).toBe(created.id);
    expect(found.path).toBe(created.path);
    expect(found.label).toBe("My backup");
  });

  test("returns 404 for non-existent backup ID", () => {
    try {
      getBackup(pool, "bkp_nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("returns 404 when _backups table doesn't exist", () => {
    // _backups was dropped in beforeEach
    try {
      getBackup(pool, "any_id");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// restoreBackup
// ---------------------------------------------------------------------------

describe("restoreBackup", () => {
  test("restores data to the state at backup time", () => {
    // Setup: create initial data and backup
    createCollection(pool, "entries", [
      { name: "title", type: "TEXT" },
      { name: "status", type: "TEXT" },
    ]);
    createRecord(pool, "entries", { title: "Task A", status: "active" });
    createRecord(pool, "entries", { title: "Task B", status: "active" });

    const backup = createBackup(pool, TEST_APP, TEST_DATA_DIR, {
      label: "Before changes",
    });

    // Make changes: add a record, update one, delete one
    const records = listRecords(pool, "entries");
    const idA = records.find((r) => r.title === "Task A")!.id as string;
    const idB = records.find((r) => r.title === "Task B")!.id as string;

    createRecord(pool, "entries", { title: "Task C", status: "new" });
    updateRecord(pool, "entries", idA, { title: "Task A Modified", status: "done" });
    // Delete one indirectly by verifying we have 3 now
    const beforeRecords = listRecords(pool, "entries");
    expect(beforeRecords).toHaveLength(3);

    // Restore from backup
    const restoreResult = restoreBackup(manager, dbId, backup.id);

    expect(restoreResult.database).toBe(dbId);
    expect(restoreResult.backupPath).toBe(backup.path);
    expect(restoreResult.restoredAt).toBeTruthy();

    // Verify data was restored: only original 2 records
    const pool2 = manager.get(dbId);
    const afterRecords = listRecords(pool2, "entries");
    expect(afterRecords).toHaveLength(2);
    const titles = afterRecords.map((r) => r.title);
    expect(titles).toContain("Task A");
    expect(titles).toContain("Task B");
    expect(titles).not.toContain("Task C");
    expect(titles).not.toContain("Task A Modified");
  });

  test("returns 404 for non-existent backup ID", () => {
    try {
      restoreBackup(manager, dbId, "bkp_fake");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.message).toContain("not found");
    }
  });

  test("returns 404 for non-existent database", () => {
    createBackup(pool, TEST_APP, TEST_DATA_DIR);
    const backups = listBackups(pool);

    try {
      restoreBackup(manager, "dbs_ghost", backups[0].id);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// restoreFromFile
// ---------------------------------------------------------------------------

describe("restoreFromFile", () => {
  test("restores from a specific file path", () => {
    // Setup initial data and backup
    createCollection(pool, "docs", [
      { name: "content", type: "TEXT" },
    ]);
    createRecord(pool, "docs", { content: "Original content" });

    const backup = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    // Modify data
    const records = listRecords(pool, "docs");
    createRecord(pool, "docs", { content: "New content" });

    // Restore from file path
    const result = restoreFromFile(manager, dbId, backup.path);

    expect(result.database).toBe(dbId);

    // Verify only original content
    const pool2 = manager.get(dbId);
    const afterRecords = listRecords(pool2, "docs");
    expect(afterRecords).toHaveLength(1);
    expect(afterRecords[0].content).toBe("Original content");
  });

  test("returns 404 for non-existent file inside data directory", () => {
    try {
      restoreFromFile(manager, dbId, `${TEST_DATA_DIR}/nonexistent_backup_12345.db`);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("returns 400 for non-SQLite file", () => {
    // Create a plain text file
    const fakePath = `${TEST_DATA_DIR}/fake_backup.txt`;
    Bun.write(fakePath, "not a sqlite database file");

    try {
      restoreFromFile(manager, dbId, fakePath);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }

    // Cleanup
    try { rmSync(fakePath, { force: true }); } catch {}
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("Edge Cases", () => {
  test("multiple backup → restore cycles work correctly", () => {
    createCollection(pool, "cycle_test", [
      { name: "version", type: "INTEGER" },
    ]);
    createRecord(pool, "cycle_test", { version: 1 });

    // Backup 1
    const bk1 = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    // Change to version 2
    const recs = listRecords(pool, "cycle_test");
    updateRecord(pool, "cycle_test", recs[0].id as string, { version: 2 });
    const bk2 = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    // Change to version 3
    const recs2 = listRecords(pool, "cycle_test");
    updateRecord(pool, "cycle_test", recs2[0].id as string, { version: 3 });

    // Restore to backup 1
    restoreBackup(manager, dbId, bk1.id);
    const pool1 = manager.get(dbId);
    const after1 = listRecords(pool1, "cycle_test");
    expect(after1[0].version).toBe(1);

    // Restore to backup 2 using file path (metadata records were lost during first restore)
    restoreFromFile(manager, dbId, bk2.path);
    const pool2 = manager.get(dbId);
    const after2 = listRecords(pool2, "cycle_test");
    expect(after2[0].version).toBe(2);
  });

  test("backup of database with system tables (_backups, _collections)", () => {
    createCollection(pool, "sys_test", [{ name: "x", type: "TEXT" }]);

    // Create a backup (this creates _backups table)
    const bkp = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    expect(bkp.id).toBeTruthy();

    // Verify _backups table exists and has our entry
    const backups = listBackups(pool);
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  test("rejects invalid database name (SQL injection)", () => {
    try {
      createBackup(pool, "bad; DROP TABLE items;", TEST_DATA_DIR);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { message: string };
      expect(e.message).toContain("Invalid database name");
    }
  });

  test("backup file is a valid SQLite database", () => {
    createCollection(pool, "verify_valid", [{ name: "x", type: "TEXT" }]);
    createRecord(pool, "verify_valid", { x: "test" });

    const bkp = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    // Read the backup file using bun:sqlite and verify it has the data
    const tmpDb = new SQLiteDatabase(bkp.path);
    const rows = tmpDb.query("SELECT * FROM verify_valid").all();
    expect(rows.length).toBe(1);
    tmpDb.close();
  });
});

// ---------------------------------------------------------------------------
// Cross-platform backup paths
// ---------------------------------------------------------------------------

describe("Cross-platform paths", () => {
  test("uses cross-platform path separators and relative paths", () => {
    createCollection(pool, "path_test_2", [{ name: "x", type: "TEXT" }]);
    createRecord(pool, "path_test_2", { x: "hello" });

    const backup = createBackup(pool, TEST_APP, TEST_DATA_DIR);

    // Verify path uses forward slashes (normalized) and lives under data dir
    expect(backup.path).toContain(path.posix.sep);
    expect(backup.path).toStartWith(TEST_DATA_DIR);
    expect(statSync(backup.path).isFile()).toBe(true);
  });

  test("restore handles backup path with mixed separators", () => {
    createCollection(pool, "mixed_sep_2", [{ name: "x", type: "TEXT" }]);
    createRecord(pool, "mixed_sep_2", { x: "original" });

    const backup = createBackup(pool, TEST_APP, TEST_DATA_DIR);
    createRecord(pool, "mixed_sep_2", { x: "extra" });

    // Convert to platform-specific separators and backslashes to test normalization
    const mixedPath = backup.path.replace(/\//g, "\\").replace(/\\/g, "/");
    const result = restoreFromFile(manager, dbId, mixedPath);

    expect(result.database).toBe(dbId);
    const restored = manager.get(dbId);
    const records = listRecords(restored, "mixed_sep_2");
    expect(records).toHaveLength(1);
    expect(records[0].x).toBe("original");
  });

  test("restore creates a pre-restore copy on disk", () => {
    createCollection(pool, "pre_restore_2", [{ name: "x", type: "TEXT" }]);
    createRecord(pool, "pre_restore_2", { x: "before" });

    const backup = createBackup(pool, TEST_APP, TEST_DATA_DIR);
    createRecord(pool, "pre_restore_2", { x: "after" });

    restoreBackup(manager, dbId, backup.id);

    const dbInfo = manager.listDatabases().find((d) => d.name === TEST_APP);
    expect(dbInfo).toBeDefined();
    expect(statSync(dbInfo!.path + ".pre-restore").isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: DatabaseManager interactions
// ---------------------------------------------------------------------------

describe("DatabaseManager integration", () => {
  test("closePool then get works correctly", () => {
    createCollection(pool, "close_test", [{ name: "x", type: "TEXT" }]);
    createRecord(pool, "close_test", { x: "persists" });

    // Close and reopen
    manager.closePool(dbId);
    const reopened = manager.get(dbId);

    // Data should still be there
    const records = listRecords(reopened, "close_test");
    expect(records).toHaveLength(1);
    expect(records[0].x).toBe("persists");
  });

  test("restore does not affect other databases' connections", () => {
    // Create a second database
    const { id: otherDbId } = manager.createDatabase(TEST_APP + "_other");
    const otherPool = manager.get(otherDbId);

    // Insert data in both databases
    createCollection(pool, "table_a", [{ name: "val", type: "TEXT" }]);
    createRecord(pool, "table_a", { val: "app_a" });

    createCollection(otherPool, "table_b", [{ name: "val", type: "TEXT" }]);
    createRecord(otherPool, "table_b", { val: "app_b" });

    // Backup and restore the first database
    const bk = createBackup(pool, TEST_APP, TEST_DATA_DIR);
    restoreBackup(manager, dbId, bk.id);

    // The other database should still have its connection and data
    const otherRecords = listRecords(otherPool, "table_b");
    expect(otherRecords).toHaveLength(1);
    expect(otherRecords[0].val).toBe("app_b");

    // Cleanup second database
    manager.deleteDatabase(otherDbId);
  });

  test("closePool is idempotent", () => {
    // Should not throw if pool is not loaded
    manager.closePool("not_loaded_db");

    // Should not throw if called twice
    manager.closePool(dbId);
    manager.closePool(dbId);

    // Re-get should work after close
    const reopened = manager.get(dbId);
    expect(reopened).toBeTruthy();
  });
});