import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, type TestContext } from "./helpers";
import { AnalyticsManager } from "../src/analytics";

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

  test("volume endpoint returns 7 slots for 7d range", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/volume?range=7d`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.slots.length).toBe(7);
    expect(json.data.counts.length).toBe(7);
  });

  test("volume endpoint returns 5 slots for 30d range", async () => {
    const res = await fetch(apiUrl(ctx, `/api/analytics/volume?range=30d`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.slots.length).toBe(5);
    expect(json.data.counts.length).toBe(5);
  });

  test("volume endpoint counts correlate with inserted events", async () => {
    // Insert a record to generate analytics activity
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/events/records`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ name: "test-volume-event" }),
    });

    // Force flush
    (ctx.analytics as { flush(): void }).flush();

    const res = await fetch(apiUrl(ctx, `/api/analytics/volume?range=24h`), { headers: adminHeaders(ctx) });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Total counts across all slots should equal or exceed the number of insert events
    const totalCount = json.data.counts.reduce((a: number, b: number) => a + b, 0);
    expect(totalCount).toBeGreaterThanOrEqual(1);
    // rows_written should reflect the insert
    const totalWritten = json.data.rows_written.reduce((a: number, b: number) => a + b, 0);
    expect(totalWritten).toBeGreaterThanOrEqual(1);
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

  test("buffer caps oldest events when flush fails repeatedly", async () => {
    const tmpDir = `/tmp/boltstore_test_cap_${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    try {
      const analytics = new AnalyticsManager(tmpDir);
      const buf = (analytics as any).buffer;

      // Close the pool so flush throws, forcing the retry and capping path
      (analytics as any).pool.close();

      // Push events past the max buffer size (1000)
      for (let i = 0; i < 1100; i++) {
        analytics.recordQuery({
          database: "test",
          operation: "select",
          durationMs: 0,
          rowCount: 0,
          status: "ok",
        });
      }

      // Buffer should be capped to MAX_BUFFER_SIZE
      expect(buf.length).toBeLessThanOrEqual(1000);

      analytics.stop();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("events are dropped after exceeding max retries", async () => {
    const tmpDir = `/tmp/boltstore_test_retry_${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    try {
      const analytics = new AnalyticsManager(tmpDir);
      const buf = (analytics as any).buffer;

      // Manually add events that already hit the retry limit
      for (let i = 0; i < 10; i++) {
        buf.push({
          event: {
            database: "test",
            operation: "select",
            durationMs: 0,
            rowCount: 0,
            status: "ok",
          },
          retries: 3, // MAX_RETRIES
        });
      }

      // Close the pool so flush throws a write error
      (analytics as any).pool.close();

      // Push one more event
      analytics.recordQuery({
        database: "test",
        operation: "select",
        durationMs: 0,
        rowCount: 0,
        status: "ok",
      });

      // Explicitly call flush — it will fail because the pool is closed,
      // exercising the retry logic (only 11 events, below FLUSH_BATCH_SIZE)
      (analytics as any).flush();

      // Events at max retries should be dropped.
      // The new event gets retried (retries becomes 1) and stays.
      expect(buf.length).toBe(1);
      expect(buf[0].retries).toBe(1);

      analytics.stop();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
