import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection } from "../src/collections";
import { queryFromParams, generateSQL } from "../src/query";
import { ServerQueryBuilder } from "../src/query/server-builder";

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
});
