import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, type TestContext } from "./helpers";

describe("Databases endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await setupTestServer(); });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("list databases returns created database", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases"), {
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThanOrEqual(1);
    expect(json.data.some((d: any) => d.name === ctx.dbName)).toBe(true);
  });

  test("get database detail", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}`), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe(ctx.dbName);
    expect(json.data.tables).toBeDefined();
  });

  test("get non-existent database returns 404", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases/nonexistent"), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    expect(res.status).toBe(404);
  });

  test("create database with invalid name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ name: "INVALID NAME!" }),
    });
    expect(res.status).toBe(400);
  });

  test("create duplicate database returns 409", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ name: ctx.dbName }),
    });
    expect(res.status).toBe(409);
  });

  test("rename database", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ name: `${ctx.dbName}_renamed` }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe(`${ctx.dbName}_renamed`);
  });

  test("delete database", async () => {
    // Create a temp database to delete
    const createRes = await fetch(apiUrl(ctx, "/api/databases"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ name: "todelete" }),
    });
    expect(createRes.status).toBe(201);

    const res = await fetch(apiUrl(ctx, "/api/databases/todelete"), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deleted).toBe(true);
  });

  test("delete non-existent database returns 404", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases/nonexistent"), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(404);
  });

  test("list databases without admin returns 401", async () => {
    const res = await fetch(apiUrl(ctx, "/api/databases"));
    expect(res.status).toBe(401);
  });
});
