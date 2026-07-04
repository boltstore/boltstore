import { createServer, stopServerBackgroundTasks } from "../src/server";
import { DatabaseManager } from "../src/db/manager";
import { AnalyticsManager } from "../src/analytics";
import { mkdirSync, rmSync } from "node:fs";

let counter = 0;

export interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  manager: DatabaseManager;
  analytics: AnalyticsManager;
  dataDir: string;
  port: number;
  adminKey: string;
  adminToken: string;
  apiKey: string;
  dbName: string;
  prevAdminKey: string | undefined;
}

export async function setupTestServer(): Promise<TestContext> {
  counter++;
  const dataDir = `/tmp/boltstore_test_${Date.now()}_${counter}`;
  const port = 9876 + (counter % 1000);
  const adminKey = `test-admin-key-${counter}`;
  const dbName = `testdb_${counter}`;

  mkdirSync(dataDir, { recursive: true });
  const prevAdminKey = Bun.env.BOLTSTORE_ADMIN_KEY;
  Bun.env.BOLTSTORE_ADMIN_KEY = adminKey;

  const manager = new DatabaseManager({ dataDir });
  const analytics = new AnalyticsManager(dataDir);
  manager.setAnalytics(analytics);
  const server = createServer({ port, manager, analytics, adminKey });

  const base = `http://localhost:${port}`;

  // Create first admin
  const setupRes = await fetch(`${base}/api/admin/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@test.com", password: "Testpassword123!" }),
  });
  if (!setupRes.ok) throw new Error(`Admin setup failed: ${await setupRes.text()}`);

  // Login
  const loginRes = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@test.com", password: "Testpassword123!" }),
  });
  if (!loginRes.ok) throw new Error(`Admin login failed: ${await loginRes.text()}`);
  const loginJson = await loginRes.json();
  const adminToken: string = loginJson.data?.token;
  if (!adminToken) throw new Error("No admin token in login response");

  // Create a database
  const dbRes = await fetch(`${base}/api/databases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: dbName }),
  });
  if (!dbRes.ok) throw new Error(`Database creation failed: ${await dbRes.text()}`);

  // Create an API key
  const keyRes = await fetch(`${base}/api/databases/${dbName}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ label: "test-key" }),
  });
  if (!keyRes.ok) throw new Error(`API key creation failed: ${await keyRes.text()}`);
  const keyJson = await keyRes.json();
  const apiKey: string = keyJson.data?.key;
  if (!apiKey || apiKey.length < 10) {
    console.error("Invalid API key response:", JSON.stringify(keyJson));
    throw new Error(`No API key in create key response`);
  }

  return { server, manager, analytics, dataDir, port, adminKey, adminToken, apiKey, dbName, prevAdminKey };
}

export async function teardownTestServer(ctx: TestContext): Promise<void> {
  stopServerBackgroundTasks();
  ctx.analytics.stop();
  ctx.manager.close();
  ctx.server.stop();
  try { rmSync(ctx.dataDir, { recursive: true, force: true }); } catch {}
  if (ctx.prevAdminKey !== undefined) {
    Bun.env.BOLTSTORE_ADMIN_KEY = ctx.prevAdminKey;
  } else {
    delete Bun.env.BOLTSTORE_ADMIN_KEY;
  }
}

export function apiUrl(ctx: TestContext, path: string): string {
  return `http://localhost:${ctx.port}${path}`;
}

export function adminHeaders(ctx: TestContext): Record<string, string> {
  if (!ctx.adminToken) console.error("WARNING: adminToken is empty!");
  return { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminToken}` };
}

export function keyHeaders(ctx: TestContext): Record<string, string> {
  if (!ctx.apiKey) console.error("WARNING: apiKey is empty!");
  return { "Content-Type": "application/json", Authorization: `Bearer ${ctx.apiKey}` };
}
