import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/server";
import { DatabaseManager } from "../src/db/manager";
import { mkdirSync, rmSync } from "node:fs";
import { createUserAndToken, createAdminApiKey, testAuthConfig } from "./helpers/auth";

const TEST_PORT = 9891;
const TEST_DATA_DIR = "/tmp/boltstore_test_sync";
let server: ReturnType<typeof Bun.serve>;
let manager: DatabaseManager;
let userToken: string;
let adminApiKey: string;
let syncDbId: string;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const result = manager.createDatabase("sync_test");
  syncDbId = result.id;
  const pool = manager.get(syncDbId);
  const user = await createUserAndToken(pool, "syncuser@test.local");
  userToken = user.token;
  adminApiKey = await createAdminApiKey(manager.getMetaPool());
  server = createServer({ port: TEST_PORT, manager, auth: testAuthConfig() });

  // Create test collections
  const createRes1 = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
    body: JSON.stringify({ name: "sync_items", columns: [{ name: "title", type: "TEXT" }, { name: "count", type: "INTEGER" }] }),
  });
  if (createRes1.status !== 201) {
    const body = await createRes1.json();
    console.error("Failed to create sync_items:", body);
  }

  const createRes2 = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
    body: JSON.stringify({ name: "tags", columns: [{ name: "label", type: "TEXT" }] }),
  });
  if (createRes2.status !== 201) {
    const body = await createRes2.json();
    console.error("Failed to create tags:", body);
  }
});

afterAll(() => {
  server.stop();
  cleanup();
});

describe("Sync Pull", () => {
  test("pull returns empty changes for empty database", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changes).toEqual([]);
    expect(body.data.cursor).toBeNull();
    expect(body.data.hasMore).toBe(false);
  });

  test("pull returns changes since cursor", async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/sync_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "sync_test_1", count: 1 }),
    });
    expect(createRes.status).toBe(201);

    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changes.length).toBeGreaterThanOrEqual(1);
    const change = body.data.changes.find((c: Record<string, unknown>) => c.collection === "sync_items" && c.event === "create");
    expect(change).toBeDefined();
    expect(change.record.title).toBe("sync_test_1");
    expect(change.seq).toBeGreaterThan(0);
  });

  test("pull with cursor excludes seen changes", async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/sync_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "sync_test_2", count: 2 }),
    });
    expect(createRes.status).toBe(201);

    // First pull to get cursor
    const firstRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ collection: "sync_items" }),
    });
    const firstBody = await firstRes.json();
    const cursor = firstBody.data.cursor;
    expect(cursor).toBeGreaterThan(0);

    // Pull with that cursor — should return only changes after it
    const secondRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ cursor }),
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    for (const change of secondBody.data.changes) {
      expect((change as Record<string, unknown>).seq).toBeGreaterThan(cursor);
    }
  });

  test("pull filters by collection", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ collection: "tags" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const change of body.data.changes) {
      expect(change.collection).toBe("tags");
    }
  });

  test("pull respects limit parameter", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ limit: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changes.length).toBeLessThanOrEqual(1);
  });

  test("pull validates request body", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
  });
});

describe("Sync Push", () => {
  test("push creates a record", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [{ event: "create", collection: "sync_items", data: { title: "pushed_create", count: 100 } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.results[0].status).toBe("created");
    expect(body.data.results[0].id).toMatch(/^rec_/);
    expect(body.data.results[0].collection).toBe("sync_items");

    // Verify record exists via REST
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ collection: "sync_items" }),
    });
    const getBody = await getRes.json();
    const created = getBody.data.changes.find((c: Record<string, unknown>) => c.record.title === "pushed_create");
    expect(created).toBeDefined();
  });

  test("push updates a record", async () => {
    // Create first
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/sync_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "to_update", count: 1 }),
    });
    const created = await createRes.json();
    const recordId = created.data.id;

    // Push update
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [{ event: "update", collection: "sync_items", id: recordId, data: { title: "updated", count: 99 } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results[0].status).toBe("updated");

    // Verify via get
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/sync_items/records/${recordId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const getBody = await getRes.json();
    expect(getBody.data.title).toBe("updated");
    expect(getBody.data.count).toBe(99);
  });

  test("push deletes a record", async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/sync_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "to_delete_push", count: 0 }),
    });
    const created = await createRes.json();
    const recordId = created.data.id;

    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [{ event: "delete", collection: "sync_items", id: recordId }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results[0].status).toBe("deleted");

    // Verify deleted
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/sync_items/records/${recordId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(getRes.status).toBe(404);
  });

  test("push returns 207 with errors for partial failure", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [
          { event: "create", collection: "sync_items", data: { title: "valid_op", count: 1 } },
          { event: "update", collection: "sync_items", id: "nonexistent_id", data: { title: "fail" } },
        ],
      }),
    });
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.results[0].status).toBe("created");
    expect(body.data.results[1].status).toBe("error");
  });

  test("push validates request body", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ operations: [] }),
    });
    expect(res2.status).toBe(400);
  });
});

describe("Conflict Resolution", () => {
  let conflictCol: string;
  let conflictRecordId: string;
  let currentUpdatedAt: string;

  beforeAll(async () => {
    conflictCol = "conflict_test";
    // Create collection with server-wins strategy
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({ name: conflictCol, columns: [{ name: "title", type: "TEXT" }, { name: "count", type: "INTEGER" }], conflictStrategy: "server-wins" }),
    });
    if (createRes.status !== 201) {
      const body = await createRes.json();
      console.error("Failed to create conflict_test:", body);
    }

    // Create a record directly
    const createRecRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${conflictCol}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "original", count: 1 }),
    });
    const created = await createRecRes.json();
    conflictRecordId = created.data.id;
    currentUpdatedAt = created.data.updated_at;
  });

  test("server-wins: returns conflict and keeps server version when baseVersion mismatch", async () => {
    // Simulate another client modifying the record
    const modifyRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${conflictCol}/records/${conflictRecordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "modified_by_server", count: 99 }),
    });
    expect(modifyRes.status).toBe(200);

    // Push update with stale baseVersion
    const pushRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [{ event: "update", collection: conflictCol, id: conflictRecordId, data: { title: "client_value", count: 0 }, baseVersion: currentUpdatedAt }],
      }),
    });
    if (pushRes.status !== 409) {
      const pushBody = await pushRes.json();
      console.log("DIAG: push returned", pushRes.status, JSON.stringify(pushBody));
      // Also fetch current record to see its updated_at
      const curRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${conflictCol}/records/${conflictRecordId}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const curBody = await curRes.json();
      console.log("DIAG: current record updated_at:", curBody.data.updated_at, "baseVersion:", currentUpdatedAt);
    }
    expect(pushRes.status).toBe(409);
    const body = await pushRes.json();
    expect(body.data.results[0].status).toBe("conflict");
    expect(body.data.results[0].conflict.strategy).toBe("server-wins");
    expect(body.data.results[0].conflict.serverVersion.title).toBe("modified_by_server");
    expect(body.data.results[0].conflict.clientVersion.title).toBe("client_value");

    // Server version should be preserved
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${conflictCol}/records/${conflictRecordId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const getBody = await getRes.json();
    expect(getBody.data.title).toBe("modified_by_server");
    expect(getBody.data.count).toBe(99);
  });

  test("last-write-wins: overwrites server version even with baseVersion mismatch", async () => {
    const lwwCol = "lww_test";
    const createColRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({ name: lwwCol, columns: [{ name: "title", type: "TEXT" }, { name: "val", type: "INTEGER" }], conflictStrategy: "last-write-wins" }),
    });
    expect(createColRes.status).toBe(201);

    // Create record
    const recRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${lwwCol}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "initial", val: 1 }),
    });
    const rec = await recRes.json();
    const recId = rec.data.id;
    const initialUpdatedAt = rec.data.updated_at;

    // Modify on server
    await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${lwwCol}/records/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "server_update", val: 2 }),
    });

    // Push with stale baseVersion — last-write-wins should overwrite
    const pushRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [{ event: "update", collection: lwwCol, id: recId, data: { title: "client_wins", val: 999 }, baseVersion: initialUpdatedAt }],
      }),
    });
    expect(pushRes.status).toBe(200);
    const body = await pushRes.json();
    expect(body.data.results[0].status).toBe("updated");

    // Client's version should win
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${lwwCol}/records/${recId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const getBody = await getRes.json();
    expect(getBody.data.title).toBe("client_wins");
    expect(getBody.data.val).toBe(999);
  });

  test("push without baseVersion does not trigger conflict detection", async () => {
    const noVerCol = "nover_test";
    const createColRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({ name: noVerCol, columns: [{ name: "title", type: "TEXT" }], conflictStrategy: "server-wins" }),
    });
    expect(createColRes.status).toBe(201);

    const recRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${noVerCol}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "original" }),
    });
    const rec = await recRes.json();
    const recId = rec.data.id;

    // Modify on server
    await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${noVerCol}/records/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "server_modified" }),
    });

    // Push WITHOUT baseVersion — should go through even with server-wins strategy
    const pushRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        operations: [{ event: "update", collection: noVerCol, id: recId, data: { title: "no_version_push" } }],
      }),
    });
    expect(pushRes.status).toBe(200);
    const body = await pushRes.json();
    expect(body.data.results[0].status).toBe("updated");

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${noVerCol}/records/${recId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const getBody = await getRes.json();
    expect(getBody.data.title).toBe("no_version_push");
  });

  test("collection creation accepts conflictStrategy field", async () => {
    const stratCol = "strat_test";
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({ name: stratCol, columns: [{ name: "x", type: "TEXT" }], conflictStrategy: "client-merge" }),
    });
    expect(createRes.status).toBe(201);
    const body = await createRes.json();
    expect(body.data.conflictStrategy).toBe("client-merge");

    // Verify via getCollection
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${stratCol}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const getBody = await getRes.json();
    expect(getBody.data.conflictStrategy).toBe("client-merge");
  });
});

describe("Sync State", () => {
  const clientId = "test_device_1";

  test("get state returns initial state for unknown client", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ clientId: "unknown_client" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.clientId).toBe("unknown_client");
    expect(body.data.cursor).toBeNull();
  });

  test("set and get state round-trips cursor", async () => {
    const setRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ clientId, cursor: 42 }),
    });
    expect(setRes.status).toBe(200);

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ clientId }),
    });
    const body = await getRes.json();
    expect(body.data.clientId).toBe(clientId);
    expect(body.data.cursor).toBe(42);
    expect(body.data.lastSyncAt).toBeTruthy();
  });

  test("updating cursor overwrites previous", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ clientId, cursor: 99 }),
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ clientId }),
    });
    const body = await getRes.json();
    expect(body.data.cursor).toBe(99);
  });

  test("RLS: pull filters changes by read_rule", async () => {
    const rlsCol = "rls_pull_test";
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/${syncDbId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({
        name: rlsCol,
        columns: [{ name: "title", type: "TEXT" }, { name: "owner_id", type: "TEXT" }],
        rls: { read: "owner_id = $userId", write: "owner_id = $userId" },
      }),
    });
    expect(createRes.status).toBe(201);

    // Store both users' info
    const pool = manager.get(syncDbId);
    const user = { token: userToken, userId: "" };
    // Look up the first user's ID from the DB
    const userRow = pool.read().query("SELECT id FROM _users WHERE email = ?").all("syncuser@test.local") as { id: string }[];
    user.userId = userRow[0].id;
    const user2 = await createUserAndToken(pool, "user2@test.local");

    // Create records as each user
    const rec1Res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${rlsCol}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "user1_record", owner_id: user.userId }),
    });
    expect(rec1Res.status).toBe(201);

    const rec2Res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/collections/${rlsCol}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user2.token}` },
      body: JSON.stringify({ title: "user2_record", owner_id: user2.userId }),
    });
    expect(rec2Res.status).toBe(201);

    // User1 pulls — should only see their own change
    const user1Pull = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ collection: rlsCol }),
    });
    expect(user1Pull.status).toBe(200);
    const user1Body = await user1Pull.json();
    expect(user1Body.data.changes.length).toBe(1);
    expect(user1Body.data.changes[0].record.title).toBe("user1_record");

    // Admin pulls — should see all changes
    const adminPull = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({ collection: rlsCol }),
    });
    expect(adminPull.status).toBe(200);
    const adminBody = await adminPull.json();
    expect(adminBody.data.changes.length).toBe(2);
  });

  test("validates clientId is required", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
