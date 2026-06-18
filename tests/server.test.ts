/**
 * Tests for the Boltstore HTTP server.
 *
 * @module tests/server
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/server";
import { DatabaseManager } from "../src/db/manager";
import { mkdirSync, rmSync } from "node:fs";
import { createAdminApiKey, createUserAndToken, testAuthConfig } from "./helpers/auth";
import pkg from "../package.json";

const TEST_PORT = 9877;
const TEST_DATA_DIR = "/tmp/boltstore_test_server";
let server: ReturnType<typeof Bun.serve>;
let manager: DatabaseManager;
let authHeaders: Record<string, string>;

function cleanup() {
  try {
    if (manager) manager.close();
  } catch {
    // ignore
  }
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

beforeAll(async () => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const apiKey = await createAdminApiKey(manager.getMetaPool());
  authHeaders = { Authorization: `Bearer ${apiKey}` };
  server = createServer({ port: TEST_PORT, manager, auth: testAuthConfig() });
});

afterAll(() => {
  server.stop();
  cleanup();
});

describe("Server startup", () => {
  test("server is running", () => {
    expect(server).toBeDefined();
    expect(server.port).toBe(TEST_PORT);
  });
});

describe("GET /api/health", () => {
  test("returns 200 with status ok", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe("ok");
    expect(body.data.version).toBe(pkg.version);
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
    expect(body.data.timestamp).toBeDefined();
    expect(body.data.databases).toBeUndefined();
  });

  test("health check does not include error field", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    const body = await response.json();
    expect(body.error).toBeUndefined();
  });
});

describe("GET /api/admin/databases", () => {
  test("returns 401 without auth", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases`);
    expect(response.status).toBe(401);
  });

  test("returns empty list initially", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases`, {
      headers: authHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  test("returns created databases", async () => {
    manager.createDatabase("servertest");

    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases`, {
      headers: authHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("servertest");

    manager.deleteDatabase("servertest");
  });
});

describe("POST /api/admin/databases", () => {
  test("creates a new database", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: "integration_test" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.name).toBe("integration_test");
    expect(body.data.createdAt).toBeTruthy();

    manager.deleteDatabase("integration_test");
  });

  test("rejects duplicate with 409", async () => {
    manager.createDatabase("dupe_test");

    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: "dupe_test" }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("REQUEST_ERROR");

    manager.deleteDatabase("dupe_test");
  });

  test("rejects missing name with 400", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/admin/databases/:database", () => {
  test("deletes an existing database", async () => {
    manager.createDatabase("delete_me");

    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases/delete_me`, {
      method: "DELETE",
      headers: authHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.deleted).toBe(true);

    expect(manager.exists("delete_me")).toBe(false);
  });

  test("returns 404 for non-existent database", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/admin/databases/ghost`, {
      method: "DELETE",
      headers: authHeaders,
    });
    expect(response.status).toBe(404);
  });
});

describe("404 handling", () => {
  test("unknown route returns 404", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/unknown`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("unknown method returns 404", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});

describe("CORS headers", () => {
  test("includes CORS headers on response", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      headers: { Origin: "http://example.com" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeTruthy();
  });

  test("handles OPTIONS preflight", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("allows any origin by default", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      headers: { Origin: "https://random-origin.com" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("API-key admin auth — system-level enforcement", () => {
  let appUserToken: string;
  let appAdminKey: string;

  beforeAll(async () => {
    // Create a second app database and a user in it
    manager.createDatabase("apikey_auth_test");
    const pool = manager.get("apikey_auth_test");
    const user = await createUserAndToken(pool, "appuser@test.local");
    appUserToken = user.token;
    // Create an admin API key inside the app DB (not the system DB)
    const { createApiKey } = await import("../src/admin/api-keys");
    const appKey = await createApiKey(pool, "app-admin-key", { operations: ["admin"] });
    appAdminKey = appKey.secret;
  });

  test("app-level admin API key cannot create API keys via system route", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/apikey_auth_test/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAdminKey}` },
      body: JSON.stringify({ name: "should-fail", permissions: {} }),
    });
    // App-level keys are not found in the system meta pool → 401
    expect(res.status).toBe(401);
  });

  test("app-level admin API key cannot list API keys via system route", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/apikey_auth_test/api-keys`, {
      headers: { Authorization: `Bearer ${appAdminKey}` },
    });
    expect(res.status).toBe(401);
  });

  test("app-level JWT user cannot create API keys", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/apikey_auth_test/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${appUserToken}` },
      body: JSON.stringify({ name: "should-fail", permissions: {} }),
    });
    // JWT from app DB is not found in system meta pool → 401
    expect(res.status).toBe(401);
  });

  test("cross-DB URL trickery is blocked — app key cannot manage keys in another app", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/apikey_auth_test/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAdminKey}` },
      body: JSON.stringify({ name: "cross-db-trick", permissions: {} }),
    });
    expect(res.status).toBe(401);
  });

  test("system-level admin API key can create API keys", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/apikey_auth_test/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: "should-succeed", permissions: {} }),
    });
    expect(res.status).toBe(201);
  });
});