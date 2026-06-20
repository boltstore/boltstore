import { test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../src/server";
import { DatabaseManager } from "../../src/db/manager";
import { DatabasePool } from "../../src/db/pool";
import { createRecord, getColumnNames } from "../../src/records";
import { notifyRecordChange } from "../../src/ws/cdc";
import { listChangesSince, bootstrapChangesTable } from "../../src/ws/changes";
import { createAdminApiKey } from "../helpers/auth";

let server: ReturnType<typeof createServer>;
let manager: DatabaseManager;
let pool: DatabasePool;
let dbId: string;
let port: number;
let apiKey: string;

beforeAll(async () => {
  const dataDir = "/tmp/boltstore-replay-e2e-" + Date.now();
  manager = new DatabaseManager({ dataDir });
  const info = manager.createDatabase("replay-e2e-db");
  dbId = info.id;
  pool = manager.get(dbId);

  // Create collection and records directly (bypassing HTTP auth)
  pool.write().run(`CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, title TEXT, user_id TEXT, created_at TEXT, updated_at TEXT)`);
  getColumnNames(pool, "items"); // warm schema cache

  // Create an API key on the meta pool for WebSocket auth
  apiKey = await createAdminApiKey(manager.getMetaPool());

  port = 19879;
  server = createServer({
    port,
    manager,
    auth: { secret: "test-secret-key-for-jwt-signing-minimum-256-bits" },
    maxBodySize: 1048576,
    enableRealtime: true,
  });

  await new Promise((r) => setTimeout(r, 300));
});

afterAll(() => {
  server.stop();
  manager.close();
});

test("SSE replay delivers missed changes after reconnect", async () => {
  // 1. Create 3 records directly via CDC, capturing seqs
  const seqs: number[] = [];
  for (const title of ["hello", "world", "foo"]) {
    const record = createRecord(pool, "items", { title, user_id: "test" });
    const seq = notifyRecordChange("create", dbId, "items", record, undefined, pool, "test");
    seqs.push(seq);
    console.log(`Created "${title}": seq=${seq}, id=${record.id}`);
  }

  expect(seqs.length).toBe(3);

  const secondToLast = seqs[seqs.length - 2];
  console.log("Subscribing with lastSeq =", secondToLast);

  // 3. Connect WebSocket
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${apiKey}&db=${dbId}`);
  const received: any[] = [];

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WS connect failed"));
  });

  ws.onmessage = (msg: MessageEvent) => {
    const data = JSON.parse(msg.data as string);
    if (data.type === "event") {
      received.push(data);
      console.log("WS received:", JSON.stringify({ title: data.record?.title, seq: data.seq }));
    }
  };

  ws.send(JSON.stringify({
    type: "subscribe",
    collection: "items",
    lastSeq: secondToLast,
  }));

  await new Promise((r) => setTimeout(r, 500));

  console.log("Total replayed:", received.length);

  // 4. Verify: only "foo" should be replayed
  expect(received.length).toBe(1);
  expect(received[0].record?.title).toBe("foo");
  expect(received[0].seq).toBeGreaterThan(secondToLast);

  // 5. Verify: live events still work
  const liveWs = new WebSocket(`ws://localhost:${port}/ws?token=${apiKey}&db=${dbId}`);
  const liveEvents: any[] = [];
  await new Promise<void>((resolve) => { liveWs.onopen = () => resolve(); });
  liveWs.onmessage = (msg: MessageEvent) => {
    const data = JSON.parse(msg.data as string);
    if (data.type === "event") {
      liveEvents.push(data);
      console.log("Live received:", JSON.stringify({ title: data.record?.title, seq: data.seq }));
    }
  };
  liveWs.send(JSON.stringify({ type: "subscribe", collection: "items" }));
  await new Promise((r) => setTimeout(r, 100));

  // Create a record while live WS is subscribed
  const newRecord = createRecord(pool, "items", { title: "live-event", user_id: "test" });
  notifyRecordChange("create", dbId, "items", newRecord, undefined, pool, "test");

  await new Promise((r) => setTimeout(r, 500));

  console.log("Live events total:", liveEvents.length);
  expect(liveEvents.length).toBeGreaterThanOrEqual(1);
  expect(liveEvents.some((e: any) => e.record?.title === "live-event")).toBe(true);
  // Live event should also have seq
  expect(liveEvents[0].seq).toBeGreaterThan(0);

  ws.close();
  liveWs.close();
});
