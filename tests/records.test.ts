import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, keyHeaders, type TestContext } from "./helpers";

describe("Records endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestServer();
    // Create a table
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({
        name: "posts",
        columns: [
          { name: "id", type: "integer", primary_key: true, auto_increment: true },
          { name: "title", type: "text", nullable: false },
          { name: "views", type: "integer", default: "0" },
          { name: "category", type: "text" },
        ],
      }),
    });
  });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("create a single record", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ title: "First Post", views: 10, category: "tech" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.title).toBe("First Post");
    expect(json.data.id).toBe(1);
  });

  test("create multiple records", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify([
        { title: "Second Post", views: 20, category: "tech" },
        { title: "Third Post", views: 30, category: "design" },
      ]),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });

  test("list records returns paginated results with meta.total", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(3);
    expect(json.meta.total).toBe(3);
    expect(json.meta.limit).toBe(50);
    expect(json.meta.offset).toBe(0);
  });

  test("list records with limit and offset", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?limit=1&offset=1`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.meta.total).toBe(3);
    expect(json.meta.offset).toBe(1);
  });

  test("list records with filter", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"category":"tech"}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.meta.total).toBe(2);
  });

  test("list records with sort ascending", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?sort=views`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].views).toBe(10);
    expect(json.data[2].views).toBe(30);
  });

  test("list records with sort descending", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?sort=-views`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].views).toBe(30);
    expect(json.data[2].views).toBe(10);
  });

  test("list records with fields projection", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?fields=title&fields=views`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].title).toBeDefined();
    expect(json.data[0].views).toBeDefined();
    expect(json.data[0].id).toBeUndefined();
  });

  test("list records with search", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?fields=title&search=First`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].title).toBe("First Post");
  });

  test("search without fields returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?search=First`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });

  test("get record by id", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records/1`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("First Post");
  });

  test("get non-existent record returns 404", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records/999`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(404);
  });

  test("update record", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records/1`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ title: "Updated Post", views: 100 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("Updated Post");
    expect(json.data.views).toBe(100);
  });

  test("delete record", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records/3`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deleted).toBe(true);
  });

  test("filter with $and operator", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"$and":[{"category":"tech"},{"views":{"$gt":15}}]}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test("filter with $or operator", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"$or":[{"category":"tech"},{"category":"design"}]}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });

  test("filter with $in operator", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"views":{"$in":[10,20]}}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });

  test("filter with $like operator", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"title":{"$like":"%Updated%"}}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test("invalid filter column name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"invalid column!@#":1}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });

  test("unsupported filter operator returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?filter={"views":{"$unsupported":1}}`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });

  test("invalid fields name returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?fields=invalid!@#`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });

  test("invalid sort field returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records?sort=invalid!@#`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });

  test("SQL injection via table name in URL returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts%22%3B%20DROP%20TABLE%20posts%3B%20--/records`), { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    expect(res.status).toBe(400);
  });

  test("SQL injection via column name in body returns 400", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/posts/records`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({ "title\"); DROP TABLE posts; --": "injection" }),
    });
    expect(res.status).toBe(400);
  });
});
