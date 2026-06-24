import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, type TestContext } from "./helpers";

describe("Tables endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await setupTestServer(); });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("list tables returns empty initially", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (res.status !== 200) {
      const text = await res.text();
      console.log("tables response:", res.status, text);
    }
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  test("create a table with valid columns", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        name: "users",
        columns: [
          { name: "id", type: "integer", primary_key: true, auto_increment: true },
          { name: "name", type: "text", nullable: false },
          { name: "email", type: "text", unique: true },
          { name: "score", type: "integer", default: "0" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.name).toBe("users");
    expect(json.data.columns).toHaveLength(4);
  });

  test("create table with references", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        name: "posts",
        columns: [
          { name: "id", type: "integer", primary_key: true },
          { name: "user_id", type: "integer", references: { table: "users", column: "id" } },
          { name: "title", type: "text" },
        ],
      }),
    });
    expect(res.status).toBe(201);
  });

  test("get table schema", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("users");
    expect(json.data.columns).toBeDefined();
    expect(json.data.columns.length).toBeGreaterThanOrEqual(4);
  });

  test("get non-existent table returns 404", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/nonexistent`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(404);
  });

  test("rename table", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ name: "articles" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("articles");
  });

  test("add column to table", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ add_columns: [{ name: "bio", type: "text" }] }),
    });
    expect(res.status).toBe(200);
  });

  test("drop column from table", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ drop_columns: ["bio"] }),
    });
    expect(res.status).toBe(200);
  });

  test("rename column", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ rename_column: { from: "score", to: "points" } }),
    });
    expect(res.status).toBe(200);
  });

  test("delete table", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/articles`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deleted).toBe(true);
  });

  test("create table with invalid name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        name: "invalid table name!",
        columns: [{ name: "id", type: "integer" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("create table with invalid column name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        name: "validtable",
        columns: [{ name: "invalid column!", type: "integer" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("create table with invalid column type returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        name: "validtable2",
        columns: [{ name: "col", type: "invalid_type" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("create table with no columns returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ name: "validtable3", columns: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("rename table with invalid name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ name: "invalid name!" }),
    });
    expect(res.status).toBe(400);
  });

  test("add column with invalid name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ add_columns: [{ name: "bad col!", type: "text" }] }),
    });
    expect(res.status).toBe(400);
  });

  test("drop column with invalid name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ drop_columns: ["bad col!"] }),
    });
    expect(res.status).toBe(400);
  });

  test("rename column with invalid name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ rename_column: { from: "bad col!", to: "good" } }),
    });
    expect(res.status).toBe(400);
  });

  test("SQL injection via table name in URL returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/users%22%3B%20DROP%20TABLE%20users%3B%20--`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });
});
