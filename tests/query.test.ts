/**
 * Tests for the query builder and execution.
 *
 * @module tests/query
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection } from "../src/collections";
import { buildQuery, executeQuery } from "../src/query";
import type { QueryParams } from "../src/query";

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
  manager.createDatabase(TEST_APP);
  pool = manager.get(TEST_APP);

  // Create a test collection with varied field types
  createCollection(pool, "products", [
    { name: "name", type: "TEXT" },
    { name: "price", type: "REAL" },
    { name: "category", type: "TEXT" },
    { name: "in_stock", type: "BOOLEAN", default: true },
    { name: "quantity", type: "INTEGER", default: 0 },
    { name: "tags", type: "TEXT" }, // JSON string for json_extract tests
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

// ---------------------------------------------------------------------------
// Filter operators
// ---------------------------------------------------------------------------

describe("filter operators", () => {
  beforeEach(() => seed());

  test("$eq — equality", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { category: { $eq: "fruit" } },
    });
    expect(data.length).toBe(2);
    expect(data.map((r: Record<string, unknown>) => r.name)).toContain("Apple");
    expect(data.map((r: Record<string, unknown>) => r.name)).toContain("Banana");
  });

  test("$neq — not equal", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { category: { $neq: "fruit" } },
    });
    expect(data.length).toBe(5);
    expect(data.map((r: Record<string, unknown>) => r.name)).not.toContain("Apple");
  });

  test("$gt / $gte — greater than", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { price: { $gt: 200 } },
    });
    // Laptop (999) and Desk (350)
    expect(data.length).toBe(2);
    const { data: d2 } = executeQuery(pool.read(), "products", {
      filter: { price: { $gte: 350 } },
    });
    expect(d2.length).toBe(2);
  });

  test("$lt / $lte — less than", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { price: { $lt: 1 } },
    });
    // Banana (0.8), Water (0.5)
    expect(data.length).toBe(2);
  });

  test("$in — in array", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { category: { $in: ["fruit", "drink"] } },
    });
    expect(data.length).toBe(3);
  });

  test("$nin — not in array", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { category: { $nin: ["fruit", "drink"] } },
    });
    expect(data.length).toBe(4);
  });

  test("$contains — substring match", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { name: { $contains: "ap" } },
    });
    // Apple, Laptop
    expect(data.length).toBe(2);
  });

  test("$startsWith", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { name: { $startsWith: "B" } },
    });
    expect(data.length).toBe(1);
  });

  test("$endsWith", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { name: { $endsWith: "e" } },
    });
    // Apple, Mouse
    expect(data.length).toBe(2);
  });

  test("$exists — IS NOT NULL / IS NULL", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { quantity: { $exists: true } },
    });
    expect(data.length).toBe(7);

    const { data: d2 } = executeQuery(pool.read(), "products", {
      filter: { quantity: { $exists: false } },
    });
    expect(d2.length).toBe(0);
  });

  test("$regexp — pattern matching (LIKE fallback)", () => {
    // regexToLike translates ^B.* → B%
    const { data } = executeQuery(pool.read(), "products", {
      filter: { name: { $regexp: "^B.*" } },
    });
    const names = data.map((r: Record<string, unknown>) => r.name);
    expect(names).toContain("Banana");
    // The LIKE fallback is anchored — ^B matches names starting with B
    expect(data.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Logical grouping
// ---------------------------------------------------------------------------

describe("logical grouping", () => {
  beforeEach(() => seed());

  test("$and — all conditions must match", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: {
        $and: [
          { category: "fruit" },
          { price: { $gt: 0.9 } },
        ],
      },
    });
    expect(data.length).toBe(1);
    expect((data[0] as Record<string, unknown>).name).toBe("Apple");
  });

  test("$or — any condition matches", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: {
        $or: [
          { category: "drink" },
          { name: { $contains: "top" } },
        ],
      },
    });
    // Water, Laptop
    expect(data.length).toBe(2);
  });

  test("$not — negate a condition", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: {
        $not: { category: "fruit" },
      },
    });
    expect(data.length).toBe(5);
  });

  test("nested $and + $or", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: {
        $and: [
          { in_stock: 1 },
          {
            $or: [
              { category: "fruit" },
              { price: { $gt: 300 } },
            ],
          },
        ],
      },
    });
    // Fruits (both in stock) + Desk (350, in stock) = 3
    expect(data.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe("sorting", () => {
  beforeEach(() => seed());

  test("single field sort ascending", () => {
    const { data } = executeQuery(pool.read(), "products", {
      sort: ["price:asc"],
    });
    expect(data[0].name).toBe("Water");   // 0.5
    expect(data[1].name).toBe("Banana");   // 0.8
    expect(data[data.length - 1].name).toBe("Laptop"); // 999
  });

  test("multi-field sort", () => {
    const { data } = executeQuery(pool.read(), "products", {
      sort: ["category:asc", "price:desc"],
    });
    // Within same category, highest price first
    expect(data[0].name).toBe("Water");   // drink
    const electronics = data.filter((r: Record<string, unknown>) => r.category === "electronics");
    expect(electronics[0].name).toBe("Laptop"); // 999 > 25
    expect(electronics[1].name).toBe("Mouse");
  });
});

// ---------------------------------------------------------------------------
// Field selection (projection)
// ---------------------------------------------------------------------------

describe("field selection", () => {
  beforeEach(() => seed());

  test("returns only specified fields", () => {
    const { data } = executeQuery(pool.read(), "products", {
      fields: ["name", "price"],
      sort: ["price:asc"],
    });
    expect(data.length).toBeGreaterThan(0);
    const row = data[0] as Record<string, unknown>;
    expect(row.name).toBeDefined();
    expect(row.price).toBeDefined();
    expect(row.category).toBeUndefined();
    expect(row.quantity).toBeUndefined();
  });

  test("json_extract field selection", () => {
    const { data } = executeQuery(pool.read(), "products", {
      fields: ["name", "tags.color"],
      filter: { category: "fruit" },
    });
    expect(data.length).toBe(2);
    const apple = data.find((r: Record<string, unknown>) => r.name === "Apple") as Record<string, unknown>;
    expect(apple.tags_color).toBeDefined();
    expect(apple.tags_color).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("pagination", () => {
  beforeEach(() => seed());

  test("offset pagination with limit and offset", () => {
    const { data } = executeQuery(pool.read(), "products", {
      sort: ["price:asc"],
      limit: 3,
      offset: 0,
    });
    expect(data.length).toBe(3);
    expect(data[0].name).toBe("Water");

    const page2 = executeQuery(pool.read(), "products", {
      sort: ["price:asc"],
      limit: 3,
      offset: 3,
    });
    expect(page2.data.length).toBe(3);
  });

  test("page/per_page returns pagination metadata", () => {
    const result = executeQuery(pool.read(), "products", { sort: ["price:asc"] }, 1, 3);
    expect(result.data.length).toBe(3);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(3);
    expect(result.meta.total).toBe(7);
    expect(result.meta.total_pages).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

describe("aggregates", () => {
  beforeEach(() => seed());

  test("$count", () => {
    const { data } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$count" },
    });
    expect(data[0]["COUNT(*)"]).toBe(7);
  });

  test("$sum", () => {
    const { data } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$sum", field: "quantity" },
    });
    // 100 + 200 + 0 + 50 + 10 + 20 + 500 = 880
    expect(data[0]["SUM(\"quantity\")"]).toBe(880);
  });

  test("$avg", () => {
    const { data } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$avg", field: "price" },
    });
    const avg = data[0]["AVG(\"price\")"] as number;
    // (1.5 + 0.8 + 999 + 25 + 350 + 150 + 0.5) / 7 ≈ 218.11
    expect(avg).toBeGreaterThan(200);
    expect(avg).toBeLessThan(220);
  });

  test("$min / $max", () => {
    const { data } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$min", field: "price" },
    });
    expect(data[0]["MIN(\"price\")"]).toBe(0.5);

    const { data: d2 } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$max", field: "price" },
    });
    expect(d2[0]["MAX(\"price\")"]).toBe(999);
  });

  test("with alias", () => {
    const { data } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$count", alias: "total_products" },
    });
    expect(data[0].total_products).toBe(7);
  });

  test("groupBy with having", () => {
    const { data } = executeQuery(pool.read(), "products", {
      aggregate: { function: "$count", alias: "cnt" },
      groupBy: "category",
      having: { cnt: { $gt: 1 } },
    });
    // "fruit" has 2, "electronics" has 2, "furniture" has 2 → 3 groups
    expect(data.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// JSON field access in filters
// ---------------------------------------------------------------------------

describe("JSON field access", () => {
  beforeEach(() => seed());

  test("filter by nested JSON field", () => {
    const { data } = executeQuery(pool.read(), "products", {
      filter: { "tags.color": "red" },
    });
    expect(data.length).toBe(1);
    expect((data[0] as Record<string, unknown>).name).toBe("Apple");
  });
});

// ---------------------------------------------------------------------------
// buildQuery (unit tests)
// ---------------------------------------------------------------------------

describe("buildQuery", () => {
  test("generates parameterized SQL", () => {
    const { sql, bindings } = buildQuery("products", {
      filter: { name: { $eq: "Apple" }, price: { $gt: 1 } },
    });
    expect(sql).toContain("SELECT *");
    expect(sql).toContain('FROM "products"');
    expect(sql).toContain("WHERE");
    expect(sql).toContain("=");
    expect(bindings.length).toBe(2);
    expect(bindings).toContain("Apple");
    expect(bindings).toContain(1);
  });

  test("builds sort clause", () => {
    const { sql } = buildQuery("products", {
      sort: ["price:desc", "name:asc"],
    });
    expect(sql).toContain('ORDER BY "price" DESC, "name" ASC');
  });

  test("builds LIMIT and OFFSET", () => {
    const { sql, bindings } = buildQuery("products", {
      limit: 10,
      offset: 20,
    });
    expect(sql).toContain("LIMIT ?");
    expect(sql).toContain("OFFSET ?");
    expect(bindings).toEqual([10, 20]);
  });
});