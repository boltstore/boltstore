import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, keyHeaders, type TestContext } from "./helpers";

describe("Query endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestServer();
    // Create a table with some data
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({
        name: "items",
        columns: [
          { name: "id", type: "integer", primary_key: true, auto_increment: true },
          { name: "title", type: "text", nullable: false },
          { name: "views", type: "integer", default: "0" },
        ],
      }),
    });
    // Insert some records
    for (let i = 1; i <= 3; i++) {
      await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/items/records`), {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        body: JSON.stringify({ title: `Item ${i}`, views: i * 10 }),
      });
    }
  });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("SELECT with API key returns data", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "SELECT * FROM items ORDER BY id" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(3);
    expect(json.data[0].title).toBe("Item 1");
  });

  test("SELECT with parameters works", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "SELECT * FROM items WHERE views > ?", params: [15] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });

  test("INSERT with non-admin API key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "INSERT INTO items (title) VALUES ('api insert')" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta.changes).toBe(1);
  });

  test("UPDATE with non-admin API key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "UPDATE items SET views = 999 WHERE id = 1" }),
    });
    expect(res.status).toBe(200);
  });

  test("DELETE with non-admin API key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "DELETE FROM items WHERE id = 1" }),
    });
    expect(res.status).toBe(200);
  });

  test("CREATE TABLE with non-admin API key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "CREATE TABLE temp_table (x TEXT)" }),
    });
    expect(res.status).toBe(200);
  });

  test("DROP TABLE with non-admin API key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "DROP TABLE IF EXISTS temp_table" }),
    });
    expect(res.status).toBe(200);
  });

  test("ATTACH with non-admin API key returns 403", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "ATTACH DATABASE '/tmp/evil.db' AS evil" }),
    });
    expect(res.status).toBe(403);
  });

  test("PRAGMA with non-admin API key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "PRAGMA journal_mode" }),
    });
    expect(res.status).toBe(200);
  });

  test("INSERT with admin key succeeds", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ sql: "INSERT INTO items (title) VALUES ('admin insert')" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta.changes).toBe(1);
  });

  test("SELECT with admin key works", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ sql: "SELECT COUNT(*) as cnt FROM items" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].cnt).toBe(4);
  });

  test("missing sql field returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("invalid JSON body returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("invalid SQL returns appropriate status", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/query`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ sql: "SELECTT * FROM items" }),
    });
    // "SELECTT" is invalid SQL — SQLite returns an error → 400
    expect(res.status).toBe(400);
  });
});
