import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer, stopServerBackgroundTasks } from "../src/server";
import { DatabaseManager } from "../src/db/manager";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const TEST_PORT = 9876;
const TEST_DATA_DIR = "/tmp/boltstore_test_admin";
const ADMIN_KEY = "test-admin-key-for-tests";

const dashboardBuilt = existsSync("admin/dist/index.html");

describe("Admin Dashboard", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  let manager: DatabaseManager | undefined;

  beforeAll(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    Bun.env.BOLTSTORE_ADMIN_KEY = ADMIN_KEY;
    manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
    server = createServer({ port: TEST_PORT, manager });
  });

  afterAll(() => {
    stopServerBackgroundTasks();
    manager?.close();
    server?.stop();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    delete Bun.env.BOLTSTORE_ADMIN_KEY;
  });

  test("serves dashboard index at /dashboard", async () => {
    if (!dashboardBuilt) return;
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Boltstore");
    expect(text).toContain("</html>");
  });

  test("serves dashboard at /dashboard/ (trailing slash)", async () => {
    if (!dashboardBuilt) return;
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard/`);
    expect(res.status).toBe(200);
  });

  test("SPA fallback for /dashboard/overview", async () => {
    if (!dashboardBuilt) return;
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard/overview`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("</html>");
  });

  test("SPA fallback for /dashboard/databases/some-db/tables/users", async () => {
    if (!dashboardBuilt) return;
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard/databases/some-db/tables/users`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("</html>");
  });

  test("API still works alongside dashboard", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  test("dashboard does not interfere with API routes", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.version).toBeDefined();
  });

  test("returns 404 for non-existent API route", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/nonexistent`);
    expect(res.status).toBe(404);
  });
});
