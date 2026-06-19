import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../src/server";
import { DatabaseManager } from "../../src/db/manager";
import { mkdirSync, rmSync } from "node:fs";
import { createUserAndToken, createAdminApiKey, testAuthConfig } from "../helpers/auth";

const TEST_PORT = 9888;
const TEST_DATA_DIR = "/tmp/boltstore_test_ws";
let server: ReturnType<typeof Bun.serve>;
let manager: DatabaseManager;
let userToken: string;
let adminApiKey: string;
let wsTestId: string;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const result = manager.createDatabase("ws_test");
  wsTestId = result.id;
  const pool = manager.get(wsTestId);
  const user = await createUserAndToken(pool, "wsuser@test.local");
  userToken = user.token;
  adminApiKey = await createAdminApiKey(manager.getMetaPool());
  server = createServer({ port: TEST_PORT, manager, auth: testAuthConfig() });
});

afterAll(() => {
  server.stop();
  cleanup();
});

describe("WebSocket connection lifecycle", () => {
  test("rejects connection without token", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/ws`, {
      headers: { Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects connection with invalid token", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/ws?token=invalid-token`, {
      headers: { Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    expect(response.status).toBe(401);
  });

  test("accepts connection with valid JWT token", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${userToken}&db=${wsTestId}`);
    const connected = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    await connected;
    ws.close();
  });

  test("accepts connection with valid API key", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${adminApiKey}`);
    const connected = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    await connected;
    ws.close();
  });

  test("receives connected message on open", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${userToken}&db=${wsTestId}`);
    const msg = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (e) => resolve(e.data as string);
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("connected");
    expect(parsed.connectionId).toBeDefined();
    expect(typeof parsed.connectionId).toBe("string");
    ws.close();
  });
});

describe("WebSocket ping/pong", () => {
  test("responds to ping with pong", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${userToken}&db=${wsTestId}`);

    // Wait for connected message first
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = () => resolve();
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });

    ws.send(JSON.stringify({ type: "ping" }));

    const msg = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (e) => resolve(e.data as string);
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("pong");
    ws.close();
  });

  test("rejects unknown message type", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${userToken}&db=${wsTestId}`);

    await new Promise<void>((resolve, reject) => {
      ws.onmessage = () => resolve();
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });

    ws.send(JSON.stringify({ type: "unknown_type" }));

    const msg = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (e) => resolve(e.data as string);
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("error");
    expect(parsed.code).toBe("UNKNOWN_TYPE");
    ws.close();
  });

  test("rejects invalid JSON message", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${userToken}&db=${wsTestId}`);

    await new Promise<void>((resolve, reject) => {
      ws.onmessage = () => resolve();
      ws.onerror = () => reject(new Error("Connection failed"));
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });

    ws.send("not-json");

    const msg = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (e) => resolve(e.data as string);
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("error");
    expect(parsed.code).toBe("INVALID_MESSAGE");
    ws.close();
  });
});
