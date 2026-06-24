import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestServer, teardownTestServer, apiUrl, adminHeaders, type TestContext } from "./helpers";

describe("Transfer (export/import)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestServer();
    // Create a table with data
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({
        name: "items",
        columns: [
          { name: "id", type: "integer", primary_key: true, auto_increment: true },
          { name: "title", type: "text" },
        ],
      }),
    });
    await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/tables/items/records`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: JSON.stringify({ title: "Export Test" }),
    });
  });
  afterAll(async () => { await teardownTestServer(ctx); });

  test("export database returns a .db file", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/export`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain(`${ctx.dbName}.db`);
    const blob = await res.blob();
    expect(blob.size).toBeGreaterThan(0);
  });

  test("export with non-admin key returns 401", async () => {
    const res = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/export`), {
      method: "POST",
      headers: { Authorization: "Bearer invalid" },
    });
    expect(res.status).toBe(401);
  });

  test("import a valid .db file", async () => {
    // First export the existing database
    const exportRes = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/export`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    const blob = await exportRes.blob();

    // Import it as a new database
    const form = new FormData();
    form.append("file", blob, "imported.db");
    form.append("name", "imported_db");
    const res = await fetch(apiUrl(ctx, "/api/databases/import"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: form,
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.name).toBe("imported_db");
  });

  test("import with duplicate name returns 409", async () => {
    const exportRes = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/export`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    const blob = await exportRes.blob();
    const form = new FormData();
    form.append("file", blob, "dup.db");
    form.append("name", ctx.dbName);
    const res = await fetch(apiUrl(ctx, "/api/databases/import"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: form,
    });
    expect(res.status).toBe(409);
  });

  test("import with invalid name returns 400", async () => {
    const exportRes = await fetch(apiUrl(ctx, `/api/databases/${ctx.dbName}/export`), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    const blob = await exportRes.blob();
    const form = new FormData();
    form.append("file", blob, "bad name!.db");
    form.append("name", "INVALID NAME!");
    const res = await fetch(apiUrl(ctx, "/api/databases/import"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test("import non-SQLite file returns 400", async () => {
    const form = new FormData();
    const fakeFile = new Blob(["not a sqlite database file at all"], { type: "application/octet-stream" });
    form.append("file", fakeFile, "fake.db");
    form.append("name", "fakedb");
    const res = await fetch(apiUrl(ctx, "/api/databases/import"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test("import without file returns 400", async () => {
    const form = new FormData();
    form.append("name", "nodbfile");
    const res = await fetch(apiUrl(ctx, "/api/databases/import"), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
