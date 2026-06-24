import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, type TestContext } from "./helpers";

describe("Config endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await setupTestServer(); });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("get config returns default config", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/config`), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
  });

  test("update config", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/config`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ readonly: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.readonly).toBe(true);
  });

  test("get config after update returns updated values", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/config`), { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.readonly).toBe(true);
  });

  test("get config without admin returns 401", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/config`));
    expect(res.status).toBe(401);
  });
});
