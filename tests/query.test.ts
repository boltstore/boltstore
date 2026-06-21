import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection } from "../src/collections";
import { queryFromParams, generateSQL } from "../src/query";
import { ServerQueryBuilder } from "../src/query/server-builder";
import { createRecord, updateRecord, deleteRecord } from "../src/records/crud";

const TEST_DATA_DIR = "/tmp/boltstore_test_query";
const TEST_APP = "queryapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { Bun.spawnSync(["rm", "-rf", TEST_DATA_DIR]); } catch {}
}

beforeAll(() => {
  cleanup();
  Bun.spawnSync(["mkdir", "-p", TEST_DATA_DIR]);
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const { id: dbId } = manager.createDatabase(TEST_APP);
  pool = manager.get(dbId);

  createCollection(pool, "products", [
    { name: "name", type: "TEXT" },
    { name: "price", type: "REAL" },
    { name: "category", type: "TEXT" },
    { name: "in_stock", type: "BOOLEAN", default: true },
    { name: "quantity", type: "INTEGER", default: 0 },
    { name: "tags", type: "TEXT" },
  ]);
});

afterAll(() => cleanup());

beforeEach(() => {
  pool.write().run('DELETE FROM "products"');
});

function seed() {
  const items = [
    { name: "Apple", price: 1.5, category: "fruit", in_stock: 1, quantity: 100, tags: '{"color":"red","size":"medium"}' },
    { name: "Banana", price: 0.8, category: "fruit", in_stock: 1, quantity: 200, tags: '{"color":"yellow","size":"medium"}' },
    { name: "Laptop", price: 999, category: "electronics", in_stock: 0, quantity: 0, tags: '{"brand":"tech","weight":"2kg"}' },
    { name: "Mouse", price: 25, category: "electronics", in_stock: 1, quantity: 50, tags: '{"brand":"tech","wireless":true}' },
    { name: "Desk", price: 350, category: "furniture", in_stock: 1, quantity: 10, tags: '{"material":"wood","color":"brown"}' },
    { name: "Chair", price: 150, category: "furniture", in_stock: 1, quantity: 20, tags: '{"material":"metal","color":"black"}' },
    { name: "Water", price: 0.5, category: "drink", in_stock: 1, quantity: 500, tags: '{"type":"sparkling"}' },
  ];

  const db = pool.write();
  for (const item of items) {
    const keys = Object.keys(item);
    const placeholders = keys.map(() => "?").join(", ");
    const quoted = keys.map((k) => `"${k}"`).join(", ");
    const vals = keys.map((k) => (item as Record<string, unknown>)[k]);
    db.run(`INSERT INTO "products" (id, created_at, updated_at, ${quoted}) VALUES (?, datetime('now'), datetime('now'), ${placeholders})`, [
      (item as Record<string, unknown>).name?.toString().toLowerCase().replace(/\s/g, "_") || `id_${Math.random().toString(36).slice(2, 8)}`,
      ...vals,
    ]);
  }
}

describe("filter operators", () => {
  beforeEach(() => seed());

  test("$eq — equality", () => {
    const data = queryFromParams({ collection: "products", filter: { category: { $eq: "fruit" } } }, pool.read()).get();
    expect(data.length).toBe(2);
    expect(data.map((r: Record<string, unknown>) => r.name)).toContain("Apple");
    expect(data.map((r: Record<string, unknown>) => r.name)).toContain("Banana");
  });

  test("$neq — not equal", () => {
    const data = queryFromParams({ collection: "products", filter: { category: { $neq: "fruit" } } }, pool.read()).get();
    expect(data.length).toBe(5);
    expect(data.map((r: Record<string, unknown>) => r.name)).not.toContain("Apple");
  });

  test("$gt / $gte — greater than", () => {
    const data = queryFromParams({ collection: "products", filter: { price: { $gt: 200 } } }, pool.read()).get();
    expect(data.length).toBe(2);

    const d2 = queryFromParams({ collection: "products", filter: { price: { $gte: 350 } } }, pool.read()).get();
    expect(d2.length).toBe(2);
  });

  test("$lt / $lte — less than", () => {
    const data = queryFromParams({ collection: "products", filter: { price: { $lt: 1 } } }, pool.read()).get();
    expect(data.length).toBe(2);
  });

  test("$in — in array", () => {
    const data = queryFromParams({ collection: "products", filter: { category: { $in: ["fruit", "drink"] } } }, pool.read()).get();
    expect(data.length).toBe(3);
  });

  test("$nin — not in array", () => {
    const data = queryFromParams({ collection: "products", filter: { category: { $nin: ["fruit", "drink"] } } }, pool.read()).get();
    expect(data.length).toBe(4);
  });

  test("$contains — substring match", () => {
    const data = queryFromParams({ collection: "products", filter: { name: { $contains: "ap" } } }, pool.read()).get();
    expect(data.length).toBe(2);
  });

  test("$startsWith", () => {
    const data = queryFromParams({ collection: "products", filter: { name: { $startsWith: "B" } } }, pool.read()).get();
    expect(data.length).toBe(1);
  });

  test("$endsWith", () => {
    const data = queryFromParams({ collection: "products", filter: { name: { $endsWith: "e" } } }, pool.read()).get();
    expect(data.length).toBe(2);
  });

  test("$exists — IS NOT NULL / IS NULL", () => {
    const data = queryFromParams({ collection: "products", filter: { quantity: { $exists: true } } }, pool.read()).get();
    expect(data.length).toBe(7);

    const d2 = queryFromParams({ collection: "products", filter: { quantity: { $exists: false } } }, pool.read()).get();
    expect(d2.length).toBe(0);
  });

  test("$regexp — pattern matching (LIKE fallback)", () => {
    const data = queryFromParams({ collection: "products", filter: { name: { $regexp: "^B.*" } } }, pool.read()).get();
    const names = data.map((r: Record<string, unknown>) => r.name);
    expect(names).toContain("Banana");
    expect(data.length).toBe(1);
  });
});

describe("logical grouping", () => {
  beforeEach(() => seed());

  test("$and — all conditions must match", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { $and: [{ category: "fruit" }, { price: { $gt: 0.9 } }] },
    }, pool.read()).get();
    expect(data.length).toBe(1);
    expect((data[0] as Record<string, unknown>).name).toBe("Apple");
  });

  test("$or — any condition matches", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { $or: [{ category: "drink" }, { name: { $contains: "top" } }] },
    }, pool.read()).get();
    expect(data.length).toBe(2);
  });

  test("$not — negate a condition", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { $not: { category: "fruit" } },
    }, pool.read()).get();
    expect(data.length).toBe(5);
  });

  test("$not — field-level negator", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { category: { $not: { $eq: "fruit" } } },
    }, pool.read()).get();
    expect(data.length).toBe(5);
  });

  test("$exists subquery — EXISTS (SELECT 1 FROM ...)", () => {
    // Create an orders table with a record referencing a product
    const db = pool.write();
    db.run(`CREATE TABLE IF NOT EXISTS "orders" ("id" TEXT, "product_id" TEXT, "status" TEXT)`);
    db.run(`INSERT INTO "orders" ("id", "product_id", "status") VALUES ('ord_1', 'laptop', 'shipped')`);
    db.run(`INSERT INTO "orders" ("id", "product_id", "status") VALUES ('ord_2', 'desk', 'pending')`);

    const data = queryFromParams({
      collection: "products",
      filter: { $subqueryExists: { collection: "orders" } },
    }, pool.read()).get();
    // All products since orders table has rows
    expect(data.length).toBe(7);
  });

  test("$exists subquery — NOT EXISTS (SELECT 1 FROM ...)", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { $subqueryNotExists: { collection: "orders", filter: { status: "cancelled" } } },
    }, pool.read()).get();
    // NOT EXISTS (SELECT 1 FROM "orders" WHERE "status" = 'cancelled') → true since no cancelled orders
    expect(data.length).toBe(7);
  });

  test("$exists subquery — with inner filter", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { $subqueryExists: { collection: "orders", filter: { status: "shipped" } } },
    }, pool.read()).get();
    // EXISTS (SELECT 1 FROM "orders" WHERE "status" = ?) → true because one shipped order exists
    expect(data.length).toBe(7);
  });

  test("$not — field-level negator with $gt", () => {
    const data = queryFromParams({
      collection: "products",
      filter: { price: { $not: { $gt: 300 } } },
    }, pool.read()).get();
    // NOT (price > 300) = price <= 300 → Apple (1.5), Banana (0.8), Mouse (25), Chair (150), Water (0.5) = 5
    expect(data.length).toBe(5);
  });

  test("nested $and + $or", () => {
    const data = queryFromParams({
      collection: "products",
      filter: {
        $and: [
          { in_stock: 1 },
          { $or: [{ category: "fruit" }, { price: { $gt: 300 } }] },
        ],
      },
    }, pool.read()).get();
    expect(data.length).toBe(3);
  });
});

describe("sorting", () => {
  beforeEach(() => seed());

  test("single field sort ascending", () => {
    const data = queryFromParams({
      collection: "products",
      sort: [{ field: "price", direction: "asc" }],
    }, pool.read()).get();
    expect(data[0].name).toBe("Water");
    expect(data[1].name).toBe("Banana");
    expect(data[data.length - 1].name).toBe("Laptop");
  });

  test("multi-field sort", () => {
    const data = queryFromParams({
      collection: "products",
      sort: [{ field: "category", direction: "asc" }, { field: "price", direction: "desc" }],
    }, pool.read()).get<Record<string, unknown>>();
    expect(data[0].name).toBe("Water");
    const electronics = data.filter((r) => r.category === "electronics");
    expect(electronics[0].name).toBe("Laptop");
    expect(electronics[1].name).toBe("Mouse");
  });
});

describe("field selection", () => {
  beforeEach(() => seed());

  test("returns only specified fields", () => {
    const data = queryFromParams({
      collection: "products",
      fields: ["name", "price"],
      sort: [{ field: "price", direction: "asc" }],
    }, pool.read()).get<Record<string, unknown>>();
    expect(data.length).toBeGreaterThan(0);
    const row = data[0];
    expect(row.name).toBeDefined();
    expect(row.price).toBeDefined();
    expect(row.category).toBeUndefined();
    expect(row.quantity).toBeUndefined();
  });

  test("json_extract field selection", () => {
    const data = queryFromParams({
      collection: "products",
      fields: ["name", "tags.color"],
      filter: { category: "fruit" },
    }, pool.read()).get<Record<string, unknown>>();
    expect(data.length).toBe(2);
    const apple = data.find((r) => r.name === "Apple")!;
    expect(apple.tags_color).toBeDefined();
    expect(apple.tags_color).toBe("red");
  });
});

describe("pagination", () => {
  beforeEach(() => seed());

  test("offset pagination with limit and offset", () => {
    const qb = queryFromParams({
      collection: "products",
      sort: [{ field: "price", direction: "asc" }],
    }, pool.read());
    const page1 = qb.clone().limit(3).offset(0).get();
    expect(page1.length).toBe(3);
    expect(page1[0].name).toBe("Water");

    const page2 = qb.clone().limit(3).offset(3).get();
    expect(page2.length).toBe(3);
  });

  test("page/per_page returns pagination metadata", () => {
    const qb = queryFromParams({
      collection: "products",
      sort: [{ field: "price", direction: "asc" }],
    }, pool.read());
    const result = qb.paginate(1, 3);
    expect(result.data.length).toBe(3);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(3);
    expect(result.meta.total).toBe(7);
    expect(result.meta.total_pages).toBe(3);
  });
});

describe("aggregates", () => {
  beforeEach(() => seed());

  test("$count", () => {
    const data = queryFromParams({ collection: "products", aggregate: { function: "$count" } }, pool.read()).get<Record<string, unknown>>();
    expect(data[0]["COUNT(*)"]).toBe(7);
  });

  test("$sum", () => {
    const data = queryFromParams({ collection: "products", aggregate: { function: "$sum", field: "quantity" } }, pool.read()).get<Record<string, unknown>>();
    // 100 + 200 + 0 + 50 + 10 + 20 + 500 = 880
    expect(data[0]['SUM("quantity")']).toBe(880);
  });

  test("$avg", () => {
    const data = queryFromParams({ collection: "products", aggregate: { function: "$avg", field: "price" } }, pool.read()).get<Record<string, unknown>>();
    const avg = data[0]['AVG("price")'] as number;
    expect(avg).toBeGreaterThan(200);
    expect(avg).toBeLessThan(220);
  });

  test("$min / $max", () => {
    const data = queryFromParams({ collection: "products", aggregate: { function: "$min", field: "price" } }, pool.read()).get<Record<string, unknown>>();
    expect(data[0]['MIN("price")']).toBe(0.5);

    const d2 = queryFromParams({ collection: "products", aggregate: { function: "$max", field: "price" } }, pool.read()).get<Record<string, unknown>>();
    expect(d2[0]['MAX("price")']).toBe(999);
  });

  test("with alias", () => {
    const data = queryFromParams({ collection: "products", aggregate: { function: "$count", alias: "total_products" } }, pool.read()).get<Record<string, unknown>>();
    expect(data[0].total_products).toBe(7);
  });

  test("groupBy with having", () => {
    const data = queryFromParams({
      collection: "products",
      aggregate: { function: "$count", alias: "cnt" },
      groupBy: "category",
      having: { cnt: { $gt: 1 } },
    }, pool.read()).get<Record<string, unknown>>();
    // "fruit":2, "electronics":2, "furniture":2 → 3 groups
    expect(data.length).toBe(3);
  });
});

describe("JSON field access", () => {
  beforeEach(() => seed());

  test("filter by nested JSON field", () => {
    const data = queryFromParams({ collection: "products", filter: { "tags.color": "red" } }, pool.read()).get<Record<string, unknown>>();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Apple");
  });
});

describe("buildQuery (via toSQL)", () => {
  test("generates parameterized SQL", () => {
    const { sql, bindings } = queryFromParams({
      collection: "products",
      filter: { name: { $eq: "Apple" }, price: { $gt: 1 } },
    }, pool.read()).toSQL();
    expect(sql).toContain("SELECT *");
    expect(sql).toContain('FROM "products"');
    expect(sql).toContain("WHERE");
    expect(sql).toContain("=");
    expect(bindings.length).toBe(2);
    expect(bindings).toContain("Apple");
    expect(bindings).toContain(1);
  });

  test("builds sort clause", () => {
    const { sql } = queryFromParams({
      collection: "products",
      sort: [{ field: "price", direction: "desc" }, { field: "name", direction: "asc" }],
    }, pool.read()).toSQL();
    expect(sql).toContain('ORDER BY "price" DESC, "name" ASC');
  });

  test("builds LIMIT and OFFSET", () => {
    const { sql, bindings } = queryFromParams({
      collection: "products",
      limit: 10,
      offset: 20,
    }, pool.read()).toSQL();
    expect(sql).toContain("LIMIT ?");
    expect(sql).toContain("OFFSET ?");
    expect(bindings).toEqual([10, 20]);
  });

  test("window function — SELECT * with ROW_NUMBER", () => {
    const db = pool.write();
    const { sql } = queryFromParams({
      collection: "products",
      windows: [{ function: "ROW_NUMBER", partitionBy: ["category"], orderBy: [{ field: "price", direction: "desc" }], alias: "rn" }],
    }, db).toSQL();
    expect(sql).toContain("SELECT *, ROW_NUMBER() OVER (PARTITION BY \"category\" ORDER BY \"price\" DESC) AS \"rn\"");
  });

  test("window function — round-trip via toParams", () => {
    const builder = new ServerQueryBuilder(pool.write());
    builder.from("products");
    builder.window([{ function: "ROW_NUMBER", partitionBy: ["category"], orderBy: [{ field: "price", direction: "desc" }], alias: "rn" }]);
    builder.select("name");
    const params = builder.toParams();
    expect((params as any).windows).toBeDefined();
    expect((params as any).windows[0].function).toBe("ROW_NUMBER");
    const rebuilt = queryFromParams(params, pool.read());
    const { sql } = rebuilt.toSQL();
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY \"category\" ORDER BY \"price\" DESC) AS \"rn\"");
  });

  test("window function — with fields", () => {
    const db = pool.write();
    const { sql } = queryFromParams({
      collection: "products",
      fields: ["name", "price"],
      windows: [{ function: "RANK", partitionBy: ["category"], orderBy: [{ field: "price", direction: "desc" }], alias: "rank" }],
    }, db).toSQL();
    expect(sql).toContain('SELECT "name", "price"');
    expect(sql).toContain('RANK() OVER (PARTITION BY "category" ORDER BY "price" DESC) AS "rank"');
  });
});

describe("RETURNING field selection", () => {
  beforeEach(() => seed());

  test("create with RETURNING selected fields", () => {
    const record = createRecord(pool, "products", { name: "Cherry", price: 500, category: "fruit" }, undefined, ["id", "name"]);
    expect(record).toHaveProperty("id");
    expect(record).toHaveProperty("name", "Cherry");
    expect(record).not.toHaveProperty("price");
  });

  test("update with RETURNING selected fields", () => {
    const record = updateRecord(pool, "products", "apple", { price: 999 }, undefined, ["id", "price"]);
    expect(record).toHaveProperty("id", "apple");
    expect(record).toHaveProperty("price", 999);
    expect(record).not.toHaveProperty("name");
  });

  test("delete with RETURNING selected fields", () => {
    const result = deleteRecord(pool, "products", "banana", undefined, ["id", "name"]) as Record<string, unknown>;
    expect(result).toHaveProperty("id", "banana");
    expect(result).toHaveProperty("name");
  });
});

describe("window functions", () => {
  beforeEach(() => seed());

  test("live ROW_NUMBER partition query", () => {
    const db = pool.read();
    const data = queryFromParams({
      collection: "products",
      fields: ["name", "category", "price"],
      windows: [{ function: "ROW_NUMBER", partitionBy: ["category"], orderBy: [{ field: "price", direction: "desc" }], alias: "rn" }],
    }, db).get();
    const fruit = data.filter((r: any) => r.category === "fruit").sort((a: any, b: any) => a.rn - b.rn);
    expect(fruit[0].rn).toBe(1);
    expect(fruit[0].name).toBe("Apple");
  });

  test("live COUNT window without partition", () => {
    const db = pool.read();
    const data = queryFromParams({
      collection: "products",
      fields: ["category", "name"],
      windows: [{ function: "COUNT", orderBy: [{ field: "name", direction: "asc" }], alias: "cnt" }],
    }, db).get();
    expect(data.length).toBe(7);
    expect(data[0]).toHaveProperty("cnt");
  });
});

describe("ON CONFLICT control", () => {
  beforeEach(() => seed());

  test("onConflict=error rejects duplicate (default)", () => {
    expect(() => createRecord(pool, "products", { id: "apple", name: "Apple2", price: 999 }, undefined)).toThrow();
  });

  test("onConflict=ignore silences duplicate", () => {
    const record = createRecord(pool, "products", { id: "apple", name: "Apple2", price: 999 }, undefined, undefined, "ignore");
    expect(record).toHaveProperty("id", "apple");
  });

  test("onConflict=upsert updates existing record", () => {
    const record = createRecord(pool, "products", { id: "apple", name: "Apple2", price: 999 }, undefined, ["id", "name", "price"], "upsert");
    expect(record).toHaveProperty("id", "apple");
    expect(record).toHaveProperty("name", "Apple2");
    expect(record).toHaveProperty("price", 999);
  });

  test("onConflict=upsert without id creates normally", () => {
    const record = createRecord(pool, "products", { name: "NewItem", price: 10 }, undefined, ["id", "name"], "upsert");
    expect(record).toHaveProperty("name", "NewItem");
  });
});

describe("inline subqueries in WHERE", () => {
  beforeEach(() => seed());

  test("$inSubquery — compile SQL", () => {
    const { sql, bindings } = queryFromParams({
      collection: "products",
      filter: { category: { $inSubquery: { collection: "orders", field: "status", filter: { total: { $gt: 100 } } } } },
    }, pool.read()).toSQL();
    expect(sql).toContain('"category" IN (SELECT "status" FROM "orders" WHERE "total" > ?)');
    expect(bindings).toContain(100);
  });

  test("$notInSubquery — compile SQL", () => {
    const { sql } = queryFromParams({
      collection: "products",
      filter: { category: { $notInSubquery: { collection: "orders", field: "status" } } },
    }, pool.read()).toSQL();
    expect(sql).toContain('"category" NOT IN (SELECT "status" FROM "orders")');
  });

  test("$subqueryEq — scalar subquery with aggregate", () => {
    const { sql } = queryFromParams({
      collection: "products",
      filter: { price: { $subqueryEq: { collection: "orders", aggregate: { function: "$avg", field: "total" } } } },
    }, pool.read()).toSQL();
    expect(sql).toContain('"price" = (SELECT AVG("total") FROM "orders")');
  });

  test("$subqueryGt — scalar comparison", () => {
    const { sql } = queryFromParams({
      collection: "products",
      filter: { price: { $subqueryGt: { collection: "orders", aggregate: { function: "$max", field: "total" } } } },
    }, pool.read()).toSQL();
    expect(sql).toContain('"price" > (SELECT MAX("total") FROM "orders")');
  });

  test("$inSubquery — live query with existing data", () => {
    const db = pool.write();
    // Create a record that won't match via subquery check
    const data = queryFromParams({
      collection: "products",
      filter: { name: { $inSubquery: { collection: "products", field: "name", filter: { price: { $gt: 50 } } } } },
    }, db).get();
    // Products with price > 50: Laptop (999), Desk (350), Mouse (25? no, 25 < 50), Chair (150)
    // So: Laptop, Desk, Chair
    expect(data.length).toBe(3);
    const names = data.map((r: any) => r.name);
    expect(names).toContain("Laptop");
    expect(names).toContain("Desk");
    expect(names).toContain("Chair");
  });
});

describe("nested relation loading (with)", () => {
  const CAT_COL = "categories_test";

  beforeAll(() => {
    const db = pool.write();
    db.run(`CREATE TABLE IF NOT EXISTS "${CAT_COL}" (id TEXT PRIMARY KEY, name TEXT, slug TEXT)`);
    db.run(`DELETE FROM "${CAT_COL}"`);
    db.run(`INSERT INTO "${CAT_COL}" (id, name, slug) VALUES ('fruit', 'Fruit', 'fruit-slug'), ('electronics', 'Electronics', 'elec-slug'), ('furniture', 'Furniture', 'furn-slug'), ('drink', 'Drink', 'drink-slug')`);
    // Add category_id to products if not exists
    try { db.run(`ALTER TABLE "products" ADD COLUMN category_id TEXT`); } catch {}
    db.run(`UPDATE "products" SET category_id = category`);
    try { db.run(`INSERT OR IGNORE INTO "_collections" (id, name) VALUES ('${CAT_COL}', '${CAT_COL}')`); } catch {}
  });

  beforeEach(() => {
    seed();
    // Reset category_id from category
    const db = pool.write();
    db.run(`UPDATE "products" SET category_id = category`);
  });

  test("with — loads single related record", () => {
    const db = pool.read();
    const catCol = CAT_COL;
    const data = queryFromParams({
      collection: "products",
      fields: ["name", "category_id"],
      with: { [catCol]: { localKey: "category_id", collection: catCol } },
    }, db).get();
    const apple = data.find((r: any) => r.name === "Apple");
    expect(apple).toBeDefined();
    expect(apple[catCol]).toBeDefined();
    expect(apple[catCol].name).toBe("Fruit");
  });

  test("with — returns null when no related record", () => {
    const db = pool.read();
    const catCol = CAT_COL;
    pool.write().run(`UPDATE "products" SET category_id = 'nonexistent' WHERE name = 'Apple'`);
    const data = queryFromParams({
      collection: "products",
      fields: ["name", "category_id"],
      with: { [catCol]: { localKey: "category_id", collection: catCol } },
    }, db).get();
    const apple = data.find((r: any) => r.name === "Apple");
    expect(apple[catCol]).toBeNull();
  });

  test("with — respects fields filter", () => {
    const db = pool.read();
    const catCol = CAT_COL;
    const data = queryFromParams({
      collection: "products",
      fields: ["name", "category_id"],
      with: { [catCol]: { localKey: "category_id", collection: catCol, fields: ["name"] } },
    }, db).get();
    const fruit = data.find((r: any) => r.name === "Apple");
    expect(fruit[catCol]).toHaveProperty("name");
    expect(fruit[catCol]).not.toHaveProperty("slug");
  });

  test("with — nested relation (author with posts)", () => {
    const db = pool.read();
    const catCol = CAT_COL;
    const qb = queryFromParams({
      collection: "products",
      fields: ["name", "category_id"],
      with: { [catCol]: { localKey: "category_id", collection: catCol, with: { products_in_cat: { collection: "products", localKey: "id", foreignKey: "category_id", fields: ["name"], multiple: true } } } },
    }, db);
    const data = qb.get();
    const apple = data.find((r: any) => r.name === "Apple");
    expect(apple[catCol]).toBeDefined();
    expect(apple[catCol]).toHaveProperty("products_in_cat");
    expect(apple[catCol].products_in_cat).toBeInstanceOf(Array);
    expect(apple[catCol].products_in_cat.length).toBe(2);
    const names = apple[catCol].products_in_cat.map((r: any) => r.name);
    expect(names).toContain("Apple");
    expect(names).toContain("Banana");
  });
});

describe("raw SQL endpoint", () => {
  beforeEach(() => seed());

  test("executes a simple SELECT via raw SQL", () => {
    const db = pool.read();
    const rows = db.query('SELECT name, price FROM "products" WHERE category = ?').all("fruit") as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain("Apple");
    expect(names).toContain("Banana");
  });

  test("applies RLS-like WHERE via raw SQL", () => {
    const db = pool.read();
    const rlsWhere = "category = ?";
    const rlsParams = ["fruit"];
    const sql = `SELECT * FROM (SELECT * FROM "products" WHERE ${rlsWhere}) AS "products"`;
    const rows = db.query(sql).all(...rlsParams) as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.category === "fruit")).toBe(true);
  });

  test("raw SQL with parameterized bindings", () => {
    const db = pool.read();
    const rows = db.query('SELECT name FROM "products" WHERE price > ? AND price < ?').all(100, 400) as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain("Desk");
    expect(names).toContain("Chair");
  });
});

describe("subquery in FROM", () => {
  beforeEach(() => seed());

  test("fromSubquery — generates wrapped SELECT with correct SQL", () => {
    const { sql, bindings } = queryFromParams({
      collection: "",
      fromSubquery: {
        alias: "p",
        collection: "products",
        query: {
          collection: "products",
          wheres: [{ type: "basic", field: "price", operator: "gt", value: 100, boolean: "and" } as any],
          orders: [],
        },
      },
    }, pool.read()).toSQL();
    expect(sql).toContain('FROM (SELECT * FROM "products" WHERE "price" > ?) AS "p"');
    expect(bindings).toContain(100);
  });

  test("fromSubquery — live query with filter", () => {
    const db = pool.read();
    const data = queryFromParams({
      collection: "",
      fromSubquery: {
        alias: "p",
        collection: "products",
        query: {
          collection: "products",
          wheres: [{ type: "basic", field: "category", operator: "eq", value: "fruit", boolean: "and" } as any],
          orders: [],
        },
      },
      fields: ["name"],
    }, db).get();
    expect(data.length).toBe(2);
    const names = data.map((r: any) => r.name);
    expect(names).toContain("Apple");
    expect(names).toContain("Banana");
  });
});

describe("subquery in JOIN", () => {
  beforeAll(() => {
    const db = pool.write();
    db.run(`DROP TABLE IF EXISTS "orders"`);
    db.run(`CREATE TABLE "orders" (id TEXT PRIMARY KEY, product_id TEXT, status TEXT, total REAL, created_at TEXT, updated_at TEXT)`);
    db.run(`INSERT INTO "orders" (id, product_id, status, total, created_at, updated_at) VALUES ('ord1', 'prod1', 'pending', 250, '2024-01-01', '2024-01-01')`);
    db.run(`INSERT INTO "orders" (id, product_id, status, total, created_at, updated_at) VALUES ('ord2', 'prod2', 'shipped', 150, '2024-01-02', '2024-01-02')`);
    db.run(`INSERT INTO "orders" (id, product_id, status, total, created_at, updated_at) VALUES ('ord3', 'prod3', 'delivered', 50, '2024-01-03', '2024-01-03')`);
  });

  beforeEach(() => seed());

  test("subquery join — generates correct SQL", () => {
    const qb = queryFromParams({
      collection: "products",
      joins: [{
        type: "inner",
        target: "o",
        subquery: {
          collection: "orders",
          query: {
            collection: "orders",
            wheres: [{ type: "basic", field: "total", operator: "gt", value: 50, boolean: "and" } as any],
            orders: [],
          },
        },
        on: [{ left: "products.name", operator: "=", right: "o.status" }],
      }],
      fields: ["products.name"],
    }, pool.read());
    const { sql, bindings } = qb.toSQL();
    expect(sql).toContain('INNER JOIN (SELECT * FROM "orders" WHERE "total" > ?) AS "o"');
    expect(sql).toContain('"products"."name" = "o"."status"');
    expect(bindings).toContain(50);
  });

  test("subquery join — left join with subquery filter", () => {
    const qb = queryFromParams({
      collection: "products",
      joins: [{
        type: "left",
        target: "recent",
        subquery: {
          collection: "orders",
          query: {
            collection: "orders",
            wheres: [{ type: "basic", field: "total", operator: "gte", value: 200, boolean: "and" } as any],
            orders: [],
          },
        },
        on: [{ left: "products.name", operator: "=", right: "recent.status" }],
      }],
      fields: ["products.name"],
    }, pool.read());
    const { sql, bindings } = qb.toSQL();
    expect(sql).toContain('LEFT JOIN (SELECT * FROM "orders" WHERE "total" >= ?) AS "recent"');
    expect(bindings).toContain(200);
  });

  test("subquery join — live data with join", () => {
    const db = pool.read();
    // Add an order that references a product for join matching
    pool.write().run('INSERT INTO "orders" (id, product_id, status, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ["join_test", "prod1", "fruit", 100, new Date().toISOString(), new Date().toISOString()]);
    const qb = queryFromParams({
      collection: "products",
      joins: [{
        type: "inner",
        target: "o",
        subquery: {
          collection: "orders",
          query: {
            collection: "orders",
            wheres: [{ type: "basic", field: "total", operator: "gt", value: 0, boolean: "and" } as any],
            orders: [],
          },
        },
        on: [{ left: "products.category", operator: "=", right: "o.status" }],
      }],
      fields: ["name"],
    }, db);
    const data = qb.get();
    // Should match products where category = 'fruit' (Apple, Banana)
    expect(data.length).toBe(2);
    const names = data.map((r: any) => r.name).sort();
    expect(names).toEqual(["Apple", "Banana"]);
  });
});

describe("many-to-many relations (through)", () => {
  beforeAll(() => {
    const db = pool.write();
    db.run(`DROP TABLE IF EXISTS "students"`);
    db.run(`DROP TABLE IF EXISTS "courses"`);
    db.run(`DROP TABLE IF EXISTS "enrollments"`);
    db.run(`CREATE TABLE "students" (id TEXT PRIMARY KEY, name TEXT)`);
    db.run(`CREATE TABLE "courses" (id TEXT PRIMARY KEY, title TEXT)`);
    db.run(`CREATE TABLE "enrollments" (id TEXT PRIMARY KEY, student_id TEXT, course_id TEXT)`);
    db.run(`INSERT INTO "students" (id, name) VALUES ('s1', 'Alice'), ('s2', 'Bob')`);
    db.run(`INSERT INTO "courses" (id, title) VALUES ('c1', 'Math'), ('c2', 'Science'), ('c3', 'Art')`);
    db.run(`INSERT INTO "enrollments" (id, student_id, course_id) VALUES ('e1', 's1', 'c1'), ('e2', 's1', 'c2'), ('e3', 's2', 'c2'), ('e4', 's2', 'c3')`);
  });

  test("many-to-many via through — loads related records through junction table", () => {
    const db = pool.read();
    const data = queryFromParams({
      collection: "students",
      with: { courses: { collection: "courses", through: "enrollments", localKey: "student_id", foreignKey: "course_id" } },
    }, db).get();
    expect(data.length).toBe(2);
    const alice = data.find((r: any) => r.id === "s1");
    expect(alice.courses).toBeInstanceOf(Array);
    expect(alice.courses.length).toBe(2);
    const titles = alice.courses.map((c: any) => c.title).sort();
    expect(titles).toEqual(["Math", "Science"]);
    const bob = data.find((r: any) => r.id === "s2");
    expect(bob.courses.length).toBe(2);
    const bobTitles = bob.courses.map((c: any) => c.title).sort();
    expect(bobTitles).toEqual(["Art", "Science"]);
  });

  test("many-to-many — respects fields filter", () => {
    const db = pool.read();
    const data = queryFromParams({
      collection: "students",
      with: { courses: { collection: "courses", through: "enrollments", localKey: "student_id", foreignKey: "course_id", fields: ["title"] } },
    }, db).get();
    const alice = data.find((r: any) => r.id === "s1");
    expect(alice.courses.length).toBe(2);
    expect(alice.courses[0]).toHaveProperty("title");
    expect(alice.courses[0]).toHaveProperty("id");
  });
});
