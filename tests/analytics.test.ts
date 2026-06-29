import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, type TestContext } from "./helpers";

describe("Daily analytics aggregation", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestServer();
    // Create a table with some data
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: adminHeaders(ctx),
      body: JSON.stringify({
        name: "events",
        columns: [
          { name: "id", type: "integer", primary_key: true, auto_increment: true },
          { name: "name", type: "text", nullable: false },
        ],
      }),
    });
  });

  afterAll(async () => { await teardownTestServer(ctx); });

  test("overview returns zeroed data for fresh database", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/overview?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.databases).toBeGreaterThanOrEqual(1);
    expect(typeof json.data.queries).toBe("number");
    expect(json.data.queries).toBeGreaterThanOrEqual(0);
  });

  test("per-database overview returns correct structure", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/${ctx.dbName}/overview?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.database).toBe(ctx.dbName);
    expect(typeof json.data.queries).toBe("number");
    expect(typeof json.data.storageBytes).toBe("number");
    expect(Array.isArray(json.data.topTables)).toBe(true);
  });

  test("databases list returns per-database stats", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/databases?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    const db = json.data.find((d: { database: string }) => d.database === ctx.dbName);
    expect(db).toBeDefined();
    expect(typeof db.queries).toBe("number");
    expect(typeof db.storageBytes).toBe("number");
  });

  test("analytics data populates after API activity and flush", async () => {
    // Perform some queries to generate analytics
    for (let i = 0; i < 5; i++) {
      await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminToken}` },
        body: JSON.stringify({ sql: "SELECT * FROM events" }),
      });
    }
    // Trigger an insert via records endpoint
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/events/records`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ name: "test-event" }),
    });

    // Force flush the analytics buffer
    (ctx.analytics as { flush(): void }).flush();

    // Overview should reflect the queries we made
    const overviewRes = await fetch(apiUrl(ctx, `/api/analytics/${ctx.dbName}/overview?range=24h`), { headers: adminHeaders(ctx) });
    expect(overviewRes.status).toBe(200);
    const overview = await overviewRes.json();
    expect(overview.data.queries).toBeGreaterThanOrEqual(5);
  });

  test("volume endpoint still returns chart data", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/volume?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.slots)).toBe(true);
    expect(json.data.slots.length).toBe(24);
    expect(Array.isArray(json.data.counts)).toBe(true);
    expect(json.data.counts.length).toBe(24);
  });

  test("errors endpoint still returns log entries", async () => {
    // Trigger an error via invalid SQL
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ sql: "SELECT FROM nonexistent_table_xyz" }),
    });

    (ctx.analytics as { flush(): void }).flush();

    const res = await fetch(apiUrl(ctx, `/api/analytics/errors?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  test("recent queries endpoint still returns individual log entries", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/${ctx.dbName}/queries?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.meta).toBeDefined();
    expect(typeof json.meta.total).toBe("number");
  });

  test("top queries endpoint returns aggregated data", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/top-queries?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });
});
