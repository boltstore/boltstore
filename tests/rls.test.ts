import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection, updateCollection } from "../src/collections";
import { createRecord, listRecords, getRecord, updateRecord, deleteRecord, countRecords } from "../src/records";
import { applyRLS, setRLS, type RLSContext } from "../src/rls";

const TEST_DATA_DIR = "/tmp/boltstore_test_rls";
const TEST_APP = "rlsapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;
const alice: RLSContext = { userId: "usr_alice", email: "alice@test.com" };
const bob: RLSContext = { userId: "usr_bob", email: "bob@test.com" };

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
  const db = pool.write();
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite|_%' ESCAPE '|' AND name NOT LIKE '|_%' ESCAPE '|'")
    .all() as { name: string }[];
  for (const row of rows) {
    try { db.run(`DROP TABLE IF EXISTS "${row.name}"`); } catch {}
  }
  try { db.run("DELETE FROM _collections WHERE name NOT LIKE 'sqlite|_%' ESCAPE '|' AND name NOT LIKE '|_%' ESCAPE '|'"); } catch {}
});

describe("applyRLS", () => {
  test("returns null when no policy configured", () => {
    createCollection(pool, "open_posts", [{ name: "title", type: "TEXT" }]);
    const result = applyRLS(pool, "open_posts", "read", alice);
    expect(result).toBeNull();
  });

  test("returns WHERE clause for read rule", () => {
    createCollection(pool, "user_posts", [{ name: "title", type: "TEXT" }], {
      rls: { read: "author_id = $userId" },
    });

    const result = applyRLS(pool, "user_posts", "read", alice);
    expect(result).not.toBeNull();
    expect(result!.whereClause).toBe("(author_id = ?)");
    expect(result!.params).toEqual(["usr_alice"]);
  });

  test("returns WHERE clause for write rule", () => {
    createCollection(pool, "writable", [{ name: "x", type: "TEXT" }], {
      rls: { write: "owner_id = $userId" },
    });

    const result = applyRLS(pool, "writable", "write", bob);
    expect(result).not.toBeNull();
    expect(result!.whereClause).toBe("(owner_id = ?)");
    expect(result!.params).toEqual(["usr_bob"]);
  });

  test("substitutes both $userId and $email", () => {
    createCollection(pool, "multi", [{ name: "x", type: "TEXT" }], {
      rls: { read: "user_id = $userId OR email = $email" },
    });

    const result = applyRLS(pool, "multi", "read", alice);
    expect(result!.params).toEqual(["usr_alice", "alice@test.com"]);
  });

  test("returns null for empty/null rule", () => {
    createCollection(pool, "empty_rules", [{ name: "x", type: "TEXT" }], {
      rls: { read: "", write: null as unknown as undefined },
    });

    expect(applyRLS(pool, "empty_rules", "read", alice)).toBeNull();
    expect(applyRLS(pool, "empty_rules", "write", alice)).toBeNull();
  });

  test("rejects unknown tokens in policy", () => {
    try {
      createCollection(pool, "bad_rule", [{ name: "x", type: "TEXT" }], {
        rls: { read: "role = $role" },
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error;
      expect(e.message).toContain("Invalid RLS token");
    }
  });
});

describe("setRLS", () => {
  test("sets read and write rules", () => {
    createCollection(pool, "new_rules", [{ name: "x", type: "TEXT" }]);
    setRLS(pool, "new_rules", { read: "owner = $userId", write: "owner = $userId" });

    const result = applyRLS(pool, "new_rules", "read", alice);
    expect(result).not.toBeNull();
    expect(result!.whereClause).toContain("owner = ?");
  });

  test("clears rules by setting to null/empty", () => {
    createCollection(pool, "clear_me", [{ name: "x", type: "TEXT" }], {
      rls: { read: "x = $userId" },
    });
    expect(applyRLS(pool, "clear_me", "read", alice)).not.toBeNull();

    setRLS(pool, "clear_me", { read: null, write: null });
    expect(applyRLS(pool, "clear_me", "read", alice)).toBeNull();
  });
});

describe("RLS integration — data isolation", () => {
  test("read_rule filters records by owner", () => {
    createCollection(pool, "docs", [
      { name: "owner_id", type: "TEXT" },
      { name: "content", type: "TEXT" },
    ], { rls: { read: "owner_id = $userId" } });

    createRecord(pool, "docs", { owner_id: "usr_alice", content: "Alice doc" });
    createRecord(pool, "docs", { owner_id: "usr_bob", content: "Bob doc" });

    // Alice sees only her records
    const aliceResult = applyRLS(pool, "docs", "read", alice)!;
    const db = pool.read();
    const aliceRecords = db
      .query(`SELECT * FROM "docs" WHERE ${aliceResult.whereClause}`)
      .all(...aliceResult.params as never[]) as Record<string, unknown>[];
    expect(aliceRecords).toHaveLength(1);
    expect(aliceRecords[0].content).toBe("Alice doc");

    // Bob sees only his records
    const bobResult = applyRLS(pool, "docs", "read", bob)!;
    const bobRecords = db
      .query(`SELECT * FROM "docs" WHERE ${bobResult.whereClause}`)
      .all(...bobResult.params as never[]) as Record<string, unknown>[];
    expect(bobRecords).toHaveLength(1);
    expect(bobRecords[0].content).toBe("Bob doc");
  });

  test("write_rule prevents unauthorized updates", () => {
    createCollection(pool, "secrets", [
      { name: "owner_id", type: "TEXT" },
      { name: "value", type: "TEXT" },
    ], { rls: { write: "owner_id = $userId" } });

    createRecord(pool, "secrets", { owner_id: "usr_alice", value: "Alice secret" });
    createRecord(pool, "secrets", { owner_id: "usr_bob", value: "Bob secret" });

    // Bob's write rule should only match his record
    const bobResult = applyRLS(pool, "secrets", "write", bob)!;
    const db = pool.write();
    const updated = db.run(
      `UPDATE "secrets" SET value='hacked' WHERE ${bobResult.whereClause} AND value=?`,
      [...bobResult.params, "Alice secret"] as never[]
    );
    expect(updated.changes).toBe(0); // No rows matched — Alice's record was protected
  });

  test("no RLS policy means open access", () => {
    createCollection(pool, "open_data", [
      { name: "value", type: "TEXT" },
    ]);

    createRecord(pool, "open_data", { value: "public" });

    // No RLS configured, so applyRLS returns null
    expect(applyRLS(pool, "open_data", "read", alice)).toBeNull();
    expect(applyRLS(pool, "open_data", "write", alice)).toBeNull();
  });
});