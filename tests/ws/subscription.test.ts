import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../src/server";
import { DatabaseManager } from "../../src/db/manager";
import { mkdirSync, rmSync } from "node:fs";
import { createUserAndToken, createAdminApiKey, createReadOnlyApiKey, testAuthConfig } from "../helpers/auth";

const TEST_PORT = 9889;
const TEST_DATA_DIR = "/tmp/boltstore_test_ws_sub";
let server: ReturnType<typeof Bun.serve>;
let manager: DatabaseManager;
let userToken: string;
let adminApiKey: string;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  manager.createDatabase("sub_test");
  const pool = manager.get("sub_test");
  const user = await createUserAndToken(pool, "subuser@test.local");
  userToken = user.token;
  adminApiKey = await createAdminApiKey(manager.getMetaPool());
  server = createServer({ port: TEST_PORT, manager, auth: testAuthConfig() });

  // Create a test collection for event broadcasting tests
  const createColRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/sub_test/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
    body: JSON.stringify({ name: "events_test", columns: [{ name: "title", type: "TEXT" }] }),
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

function connectWs(token: string, database?: string): WebSocket {
  const dbParam = database ? `&database=${database}` : "";
  return new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${token}${dbParam}`);
}

function makeMessagingWs(token: string, database?: string): { ws: WebSocket; nextMessage: () => Promise<unknown>; waitForConnected: () => Promise<string>; close: () => void } {
  const ws = connectWs(token, database);
  const queue: unknown[] = [];
  let resolver: ((value: unknown) => void) | null = null;
  let connectedResolver: ((connectionId: string) => void) | null = null;

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string);
    if (msg.type === "connected" && connectedResolver) {
      connectedResolver(msg.connectionId);
      connectedResolver = null;
      return;
    }
    if (resolver) {
      resolver(msg);
      resolver = null;
    } else {
      queue.push(msg);
    }
  };

  const nextMessage = (): Promise<unknown> => {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }
    return new Promise((resolve, reject) => {
      resolver = resolve;
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout waiting for message")), 3000);
    });
  };

  const waitForConnected = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      connectedResolver = resolve;
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout waiting for connected")), 3000);
    });
  };

  const close = () => ws.close();

  return { ws, nextMessage, waitForConnected, close };
}

describe("WebSocket subscribe authorization", () => {
  test("non-admin user cannot subscribe to system collection", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "_users" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("FORBIDDEN");

    close();
  });

  test("admin user can subscribe to system collection", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(adminApiKey, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "_users" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("subscribed");
    expect(typeof msg.subscriptionId).toBe("string");

    close();
  });

  test("API key scoped to one collection cannot subscribe to another", async () => {
    const scopedKey = await createReadOnlyApiKey(manager.getMetaPool(), ["events_test"]);
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(scopedKey, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "other_collection" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("FORBIDDEN");

    close();
  });

  test("API key scoped to a collection can subscribe to it", async () => {
    const scopedKey = await createReadOnlyApiKey(manager.getMetaPool(), ["events_test"]);
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(scopedKey, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "events_test" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("subscribed");
    expect(typeof msg.subscriptionId).toBe("string");

    close();
  });
});

describe("WebSocket subscribe/unsubscribe", () => {
  test("subscribe to collection returns subscriptionId", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "items" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("subscribed");
    expect(typeof msg.subscriptionId).toBe("string");

    close();
  });

  test("subscribe without database returns error", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(adminApiKey);
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "items" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("NO_DATABASE");

    close();
  });

  test("unsubscribe removes subscription", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "items" }));
    const subMsg = await nextMessage() as Record<string, unknown>;
    const subId = subMsg.subscriptionId as string;

    ws.send(JSON.stringify({ type: "unsubscribe", subscriptionId: subId }));
    const unsubMsg = await nextMessage() as Record<string, unknown>;
    expect(unsubMsg.type).toBe("unsubscribed");
    expect(unsubMsg.subscriptionId).toBe(subId);

    close();
  });

  test("unsubscribe with invalid id returns error", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "unsubscribe", subscriptionId: "nonexistent" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("SUBSCRIPTION_NOT_FOUND");

    close();
  });

  test("subscribe to specific record", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "items", recordId: "rec_123" }));
    const msg = await nextMessage() as Record<string, unknown>;
    expect(msg.type).toBe("subscribed");
    expect(typeof msg.subscriptionId).toBe("string");

    close();
  });
});

describe("Realtime event authorization", () => {
  test("API key does not receive events from unsubscribed collection", async () => {
    const scopedKey = await createReadOnlyApiKey(manager.getMetaPool(), ["other_collection"]);
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(scopedKey, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "events_test" }));
    const subMsg = await nextMessage() as Record<string, unknown>;
    expect(subMsg.type).toBe("error");
    expect(subMsg.code).toBe("FORBIDDEN");

    close();
  });

  test("user does not receive delete event from RLS-protected collection", async () => {
    // Create a second user
    const otherUser = await createUserAndToken(manager.get("sub_test"), "other@sub.local");

    // Create a collection with a read RLS rule so users only see their own rows
    const rlsCreateRes = await fetch(`http://localhost:${TEST_PORT}/api/admin/sub_test/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminApiKey}` },
      body: JSON.stringify({
        name: "private_items",
        columns: [{ name: "title", type: "TEXT" }, { name: "owner_id", type: "TEXT" }],
        rls: { read: "owner_id = $userId" },
      }),
    });
    expect(rlsCreateRes.status).toBe(201);

    // Listener is user A
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();
    ws.send(JSON.stringify({ type: "subscribe", collection: "private_items" }));
    await nextMessage();

    // User B creates a record
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/private_items/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherUser.token}` },
      body: JSON.stringify({ title: "secret", owner_id: otherUser.userId }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    // User B deletes the record
    const deleteRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/private_items/records/${created.data.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${otherUser.token}` },
    });
    expect(deleteRes.status).toBe(200);

    // User A should not receive the create or delete event
    const gotEvent = await Promise.race([
      nextMessage().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(gotEvent).toBe(false);

    close();
  });
});

describe("Realtime event broadcasting", () => {
  test("receives event after record create via REST API", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    // Subscribe to the collection
    ws.send(JSON.stringify({ type: "subscribe", collection: "events_test" }));
    await nextMessage();

    // Create a record via REST
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/events_test/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "hello" }),
    });
    expect(createRes.status).toBe(201);

    const event = await nextMessage() as Record<string, unknown>;
    expect(event.type).toBe("event");
    expect(event.event).toBe("create");
    expect(event.collection).toBe("events_test");
    expect(event.database).toBe("sub_test");
    expect((event.record as Record<string, unknown>).title).toBe("hello");

    close();
  });

  test("receives event after record update via REST API", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "events_test" }));
    await nextMessage();

    // Create a record first
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/events_test/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "before" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const recordId = created.data.id;

    // Consume the create event
    await nextMessage();

    // Update the record
    const updateRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/events_test/records/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "after" }),
    });
    expect(updateRes.status).toBe(200);

    const event = await nextMessage() as Record<string, unknown>;
    expect(event.type).toBe("event");
    expect(event.event).toBe("update");
    expect(event.collection).toBe("events_test");
    expect((event.record as Record<string, unknown>).title).toBe("after");
    expect(event.previous).toBeDefined();
    expect((event.previous as Record<string, unknown>).title).toBe("before");

    close();
  });

  test("receives event after record delete via REST API", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    ws.send(JSON.stringify({ type: "subscribe", collection: "events_test" }));
    await nextMessage();

    // Create a record
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/events_test/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "delete_me" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const recordId = created.data.id;

    // Consume the create event
    await nextMessage();

    // Delete the record
    const deleteRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/events_test/records/${recordId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(deleteRes.status).toBe(200);

    const event = await nextMessage() as Record<string, unknown>;
    expect(event.type).toBe("event");
    expect(event.event).toBe("delete");
    expect(event.collection).toBe("events_test");
    expect((event.record as Record<string, unknown>).id).toBe(recordId);

    close();
  });

  test("does not receive events for unsubscribed collections", async () => {
    const { ws, nextMessage, waitForConnected, close } = makeMessagingWs(userToken, "sub_test");
    await waitForConnected();

    // Subscribe to a different collection
    ws.send(JSON.stringify({ type: "subscribe", collection: "other_collection" }));
    await nextMessage();

    // Create a record in events_test (not subscribed)
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/sub_test/collections/events_test/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "should_not_arrive" }),
    });
    expect(createRes.status).toBe(201);

    // Wait a short time — should NOT receive an event
    const gotEvent = await Promise.race([
      nextMessage().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(gotEvent).toBe(false);

    close();
  });
});
