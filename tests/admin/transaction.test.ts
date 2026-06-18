/**
 * Tests for the transaction API.
 *
 * @module tests/admin/transaction
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../../src/db/manager";
import { executeTransaction, type TransactionOperation } from "../../src/admin/transaction";

const TEST_DATA_DIR = "/tmp/boltstore_test_txn";
const TEST_APP = "txnapp";

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
  const db = pool.write();
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const row of rows) {
    try { db.run(`DROP TABLE IF EXISTS "${row.name}"`); } catch {}
  }
  db.run("CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, balance REAL)");
  db.run("INSERT INTO accounts VALUES ('a', 'Alice', 100)");
  db.run("INSERT INTO accounts VALUES ('b', 'Bob', 200)");
});

describe("executeTransaction", () => {
  test("executes multiple write operations atomically", () => {
    const operations: TransactionOperation[] = [
      { sql: "UPDATE accounts SET balance = balance - ? WHERE id = ?", params: [50, "a"] },
      { sql: "UPDATE accounts SET balance = balance + ? WHERE id = ?", params: [50, "b"] },
    ];

    const result = executeTransaction(pool, operations);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].changes).toBe(1);
    expect(result.results[1].changes).toBe(1);

    // Verify the transfer happened
    const alice = pool.read().query("SELECT balance FROM accounts WHERE id='a'").get() as { balance: number };
    const bob = pool.read().query("SELECT balance FROM accounts WHERE id='b'").get() as { balance: number };
    expect(alice.balance).toBe(50);
    expect(bob.balance).toBe(250);
  });

  test("rolls back all operations on failure", () => {
    const operations: TransactionOperation[] = [
      { sql: "UPDATE accounts SET balance = balance - ? WHERE id = ?", params: [50, "a"] },
      // This will fail because 'balance' is REAL but we're intentionally causing a constraint violation
      { sql: "INSERT INTO accounts VALUES (?, ?, ?)", params: ["a", "Duplicate", 999] },
    ];

    try {
      executeTransaction(pool, operations);
      expect.unreachable("Should have thrown");
    } catch {
      // Expected — duplicate primary key 'a'
    }

    // Both operations should have rolled back
    const alice = pool.read().query("SELECT balance FROM accounts WHERE id='a'").get() as { balance: number };
    expect(alice.balance).toBe(100); // Unchanged
  });

  test("supports SELECT operations within a transaction", () => {
    const operations: TransactionOperation[] = [
      { sql: "SELECT * FROM accounts WHERE id = ?", params: ["a"] },
      { sql: "UPDATE accounts SET balance = ? WHERE id = ?", params: [999, "a"] },
    ];

    const result = executeTransaction(pool, operations);
    expect(result.results).toHaveLength(2);

    // First result should be the SELECT
    const selectResult = result.results[0];
    expect(selectResult.rows).toHaveLength(1);
    expect((selectResult.rows!)[0].name).toBe("Alice");
    expect(selectResult.columns).toContain("name");
    expect(selectResult.columns).toContain("balance");

    // Second result should be the UPDATE
    expect(result.results[1].changes).toBe(1);

    // Verify update persisted
    const alice = pool.read().query("SELECT balance FROM accounts WHERE id='a'").get() as { balance: number };
    expect(alice.balance).toBe(999);
  });

  test("captures lastInsertRowid for INSERT operations", () => {
    const operations: TransactionOperation[] = [
      { sql: "INSERT INTO accounts VALUES (?, ?, ?)", params: ["c", "Charlie", 300] },
    ];

    const result = executeTransaction(pool, operations);
    expect(result.results[0].lastInsertRowid).toBeDefined();
    expect(Number(result.results[0].lastInsertRowid)).toBeGreaterThan(0);
  });

  test("rejects empty operations array (400)", () => {
    try {
      executeTransaction(pool, []);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("mixed SELECT, INSERT, UPDATE, DELETE in one transaction", () => {
    const operations: TransactionOperation[] = [
      { sql: "SELECT COUNT(*) as cnt FROM accounts" },
      { sql: "INSERT INTO accounts VALUES (?, ?, ?)", params: ["d", "Diana", 400] },
      { sql: "UPDATE accounts SET name = ? WHERE id = ?", params: ["Alice Updated", "a"] },
      { sql: "DELETE FROM accounts WHERE id = ?", params: ["b"] },
      { sql: "SELECT * FROM accounts ORDER BY id" },
    ];

    const result = executeTransaction(pool, operations);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(5);

    // [0] SELECT COUNT: 2 rows originally
    expect(result.results[0].rows![0].cnt).toBe(2);

    // [1] INSERT
    expect(result.results[1].changes).toBe(1);

    // [2] UPDATE
    expect(result.results[2].changes).toBe(1);

    // [3] DELETE
    expect(result.results[3].changes).toBe(1);

    // [4] SELECT * — should have 2 rows (Alice Updated + Diana)
    expect(result.results[4].rows).toHaveLength(2);
    const names = result.results[4].rows!.map((r) => r.name);
    expect(names).toContain("Alice Updated");
    expect(names).toContain("Diana");
  });
});