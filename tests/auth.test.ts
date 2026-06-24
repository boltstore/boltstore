import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, keyHeaders, type TestContext } from "./helpers";

describe("Authentication", () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await setupTestServer(); });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("admin status returns hasAdmins", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/status"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.hasAdmins).toBe(true);
  });

  test("admin login with wrong password returns 401", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
  });

  test("admin login with unknown email returns 401", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@test.com", password: "testpassword123" }),
    });
    expect(res.status).toBe(401);
  });

  test("admin me returns current admin", async () => {
    // Login first to get a fresh token
    const loginRes = await fetch(apiUrl(ctx, "/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "testpassword123" }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = await loginRes.json();
    const token = loginJson.data.token;
    expect(token).toBeDefined();

    const res = await fetch(apiUrl(ctx, "/api/admin/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.email).toBe("admin@test.com");
    expect(json.data.id).toBeDefined();
  });

  test("admin me without token returns 401", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/me"));
    expect(res.status).toBe(401);
  });

  test("admin me with invalid token returns 401", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/me"), {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
  });

  test("admin logout invalidates session", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/logout"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(200);

    const meRes = await fetch(apiUrl(ctx, "/api/admin/me"), {
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(meRes.status).toBe(401);
  });

  test("admin setup with duplicate email returns 409", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/setup"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminKey}` },
      body: JSON.stringify({ email: "admin@test.com", password: "testpassword123" }),
    });
    expect(res.status).toBe(409);
  });

  test("admin setup with bootstrap key creates additional admin", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/setup"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminKey}` },
      body: JSON.stringify({ email: "admin2@test.com", password: "testpassword456" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.email).toBe("admin2@test.com");
  });

  test("admin setup without bootstrap key after admins exist returns 401", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/setup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin3@test.com", password: "testpassword789" }),
    });
    expect(res.status).toBe(401);
  });

  test("admin setup with consumed bootstrap key returns 403", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/setup"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminKey}` },
      body: JSON.stringify({ email: "admin4@test.com", password: "testpassword999" }),
    });
    expect(res.status).toBe(403);
  });

  test("admin setup with short password returns 400", async () => {
    const res = await fetch(apiUrl(ctx, "/api/admin/setup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@test.com", password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  test("API key can access tables", async () => {
    // Login fresh since ctx.adminToken may have been logged out
    const loginRes = await fetch(apiUrl(ctx, "/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "testpassword123" }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = await loginRes.json();
    const freshAdminToken = loginJson.data.token;

    // Create a fresh API key
    const keyRes = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshAdminToken}` },
      body: JSON.stringify({ label: "fresh-key" }),
    });
    expect(keyRes.status).toBe(201);
    const keyJson = await keyRes.json();
    const freshKey = keyJson.data.key;
    expect(freshKey).toMatch(/^boltstore_/);

    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshKey}` },
    });
    expect(res.status).toBe(200);
  });

  test("API key cannot access admin routes", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases"), keyHeaders(ctx));
    expect(res.status).toBe(401);
  });

  test("API key cannot access another database", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases/otherdb/tables"), keyHeaders(ctx));
    expect(res.status).toBe(401);
  });

  test("invalid API key returns 401", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      headers: { Authorization: "Bearer boltstore_invalidkey" },
    });
    expect(res.status).toBe(401);
  });

  test("missing Authorization header returns 401", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`));
    expect(res.status).toBe(401);
  });
});
