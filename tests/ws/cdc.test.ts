import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../src/server";
import { DatabaseManager } from "../../src/db/manager";
import { mkdirSync, rmSync } from "node:fs";
import { createUserAndToken, createAdminApiKey, testAuthConfig } from "../helpers/auth";

const TEST_PORT = 9890;
const TEST_DATA_DIR = "/tmp/boltstore_test_cdc";
let server: ReturnType<typeof Bun.serve>;
let manager: DatabaseManager;
let userToken: string;
let adminApiKey: string;
let cdcTestId: string;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const result = manager.createDatabase("cdc_test");
  cdcTestId = result.id;
  const pool = manager.get(cdcTestId);
  const user = await createUserAndToken(pool, "cdcuser@test.local");
  userToken = user.token;
  adminApiKey = await createAdminApiKey(manager.getMetaPool());
  server = createServer({ port: TEST_PORT, manager, auth: testAuthConfig() });

  // Create a test collection
  const createColRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/${cdcTestId}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
    body: JSON.stringify({ name: "cdc_items", columns: [{ name: "title", type: "TEXT" }, { name: "count", type: "INTEGER" }] }),
  });
  if (createColRes.status !== 201) {
    const body = await createColRes.json();
    console.error("Failed to create test collection:", body);
  }
});

afterAll(() => {
  server.stop();
  cleanup();
});

describe("CDC change log persistence", () => {
  test("changes endpoint returns empty list initially", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/changes`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  test("create record persists a change entry", async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/collections/cdc_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "first", count: 1 }),
    });
    expect(createRes.status).toBe(201);

    const changesRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/changes`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(changesRes.status).toBe(200);
    const body = await changesRes.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const change = body.data[0];
    expect(change.event).toBe("create");
    expect(change.collection).toBe("cdc_items");
    expect(change.record.title).toBe("first");
    expect(change.record.count).toBe(1);
    expect(change.recordId).toBe(change.record.id);
    expect(change.previous).toBeNull();
  });

  test("update record persists a change entry with previous", async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/collections/cdc_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "before_update", count: 10 }),
    });
    const created = await createRes.json();
    const recordId = created.data.id;

    const updateRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/collections/cdc_items/records/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "after_update", count: 20 }),
    });
    expect(updateRes.status).toBe(200);

    const changesRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/changes?collection=cdc_items`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const body = await changesRes.json();
    const updateChange = body.data.find((c: Record<string, unknown>) => c.event === "update");
    expect(updateChange).toBeDefined();
    expect(updateChange.record.title).toBe("after_update");
    expect(updateChange.record.count).toBe(20);
    expect(updateChange.previous).toBeDefined();
    expect(updateChange.previous.title).toBe("before_update");
    expect(updateChange.previous.count).toBe(10);
  });

  test("delete record persists a change entry", async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/collections/cdc_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "to_delete", count: 99 }),
    });
    const created = await createRes.json();
    const recordId = created.data.id;

    const deleteRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/collections/cdc_items/records/${recordId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(deleteRes.status).toBe(200);

    const changesRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/changes?collection=cdc_items`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const body = await changesRes.json();
    const deleteChange = body.data.find((c: Record<string, unknown>) => c.event === "delete" && c.recordId === recordId);
    expect(deleteChange).toBeDefined();
    expect(deleteChange.record.title).toBe("to_delete");
  });

  test("changes can be filtered by collection", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/changes?collection=cdc_items`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const change of body.data) {
      expect(change.collection).toBe("cdc_items");
    }
  });

  test("changes can be filtered by since timestamp", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/changes?since=${future}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

describe("SSE event stream", () => {
  test("SSE endpoint returns 200 with correct content type", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/stream`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  test("SSE stream receives events after record changes", async () => {
    const sseRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/events/stream`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body?.getReader();
    expect(reader).toBeDefined();

    // Create a record
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/${cdcTestId}/collections/cdc_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "sse_test", count: 42 }),
    });
    expect(createRes.status).toBe(201);

    // Read from SSE stream
    const decoder = new TextDecoder();
    let data = "";
    const timeout = setTimeout(() => {}, 3000);

    while (!data.includes("create")) {
      const result = await reader!.read();
      if (result.done) break;
      data += decoder.decode(result.value, { stream: true });
    }
    clearTimeout(timeout);

    expect(data).toContain("event");
    expect(data).toContain("create");
    expect(data).toContain("sse_test");
    expect(data).toContain("cdc_items");

    reader!.cancel();
  });
});
