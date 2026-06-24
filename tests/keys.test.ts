import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, type TestContext } from "./helpers";

describe("API Keys endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await setupTestServer(); });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("list keys returns created key", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].label).toBe("test-key");
    expect(json.data[0].id).toBeDefined();
    expect(json.data[0].hash).toBeUndefined();
  });

  test("create a new key", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ label: "new-key" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.label).toBe("new-key");
    expect(json.data.key).toMatch(/^boltstore_/);
    expect(json.data.id).toBeDefined();
  });

  test("create key without label returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("rotate a key", async () => {
    const listRes = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    const listJson = await listRes.json();
    const keyId = listJson.data[0].id;

    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys/${keyId}/rotate`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.key).toMatch(/^boltstore_/);
    expect(json.data.id).toBe(keyId);
  });

  test("revoke a key", async () => {
    const listRes = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    const listJson = await listRes.json();
    const keyId = listJson.data[0].id;

    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys/${keyId}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.revoked).toBe(true);
  });

  test("revoke non-existent key returns 404", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys/nonexistent`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(404);
  });

  test("list keys without admin returns 401", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/keys`));
    expect(res.status).toBe(401);
  });
});
