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

  test("validates clientId is required", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${syncDbId}/sync/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
