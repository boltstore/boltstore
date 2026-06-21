import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import { createCollection } from "../src/collections";
import { queryFromParams } from "../src/query/from-params";
import { ServerQueryBuilder } from "../src/query/server-builder";
import { generateSQL, compileWheresNoSearch } from "../src/query/sql-generator";

const TEST_DATA_DIR = "/tmp/boltstore_test_sqb";
const TEST_APP = "sqbtest";

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

  createCollection(pool, "items", [
    { name: "name", type: "TEXT" },
    { name: "price", type: "REAL" },
    { name: "category", type: "TEXT" },
    { name: "active", type: "BOOLEAN", default: true },
  ]);
});

afterAll(() => cleanup());

beforeEach(() => {
  pool.write().run('DELETE FROM "items"');
});

function seed() {
  const db = pool.write();
  const items = [
    { name: "Apple", price: 1.5, category: "fruit", active: 1 },
    { name: "Banana", price: 0.8, category: "fruit", active: 1 },
    { name: "Laptop", price: 999, category: "electronics", active: 0 },
    { name: "Mouse", price: 25, category: "electronics", active: 1 },
    { name: "Desk", price: 350, category: "furniture", active: 1 },
  ];
  for (const item of items) {
    const keys = Object.keys(item);
    const quoted = keys.map((k) => `"${k}"`).join(", ");
    const ph = keys.map(() => "?").join(", ");
    const vals = keys.map((k) => (item as Record<string, unknown>)[k]);
    db.run(`INSERT INTO "items" (id, created_at, updated_at, ${quoted}) VALUES (?, datetime('now'), datetime('now'), ${ph})`, [
      item.name.toLowerCase().replace(/\s/g, "_"),
      ...vals,
    ]);
  }
}

describe("generateSQL — SQL output assertions", () => {
  test("simple SELECT * FROM", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toBe('SELECT * FROM "items"');
    expect(bindings).toEqual([]);
  });

  test("SELECT with field projection", () => {
    const { sql } = generateSQL({
      collection: "items",
      fields: ["name", "price"],
      wheres: [], orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain('SELECT "name", "price"');
  });

  test("WHERE with $eq", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [{ type: "basic", field: "name", operator: "eq", value: "Apple", boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain('WHERE "name" = ?');
    expect(bindings).toEqual(["Apple"]);
  });

  test("WHERE with $and / $or grouping", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [
        { type: "basic", field: "category", operator: "eq", value: "fruit", boolean: "and" },
        { type: "basic", field: "price", operator: "gt", value: 1, boolean: "or" },
      ],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("WHERE");
    expect(bindings).toEqual(["fruit", 1]);
  });

  test("WHERE with LIKE", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [{ type: "like", field: "name", operator: "like", value: "%pp%", boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("LIKE ?");
    expect(bindings).toEqual(["%pp%"]);
  });

  test("WHERE with BETWEEN", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [{ type: "between", field: "price", operator: "between", value: [10, 500], boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("BETWEEN ? AND ?");
    expect(bindings).toEqual([10, 500]);
  });

  test("ORDER BY", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [],
      orders: [{ field: "price", direction: "desc" }, { field: "name", direction: "asc" }],
      joins: [], withs: [], unions: [],
    });
    expect(sql).toContain('ORDER BY "price" DESC, "name" ASC');
  });

  test("LIMIT and OFFSET", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      limit: 10, offset: 5,
    });
    expect(sql).toContain("LIMIT ?");
    expect(sql).toContain("OFFSET ?");
    expect(bindings).toEqual([10, 5]);
  });

  test("aggregate COUNT", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      aggregate: [{ function: "$count", field: "*", alias: "total" }],
    });
    expect(sql).toContain('SELECT COUNT(*) AS "total"');
  });

  test("multi-aggregate", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      aggregate: [
        { function: "$count", field: "*", alias: "c" },
        { function: "$sum", field: "price", alias: "s" },
      ],
    });
    expect(sql).toContain('SELECT COUNT(*) AS "c"');
    expect(sql).toContain('SUM("price") AS "s"');
  });

  test("GROUP BY with HAVING", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      aggregate: [{ function: "$count", alias: "cnt" }],
      groupBy: ["category"],
      having: [{ type: "basic", field: "cnt", operator: "gt", value: 1, boolean: "and" }],
    });
    expect(sql).toContain('GROUP BY "category"');
    expect(sql).toContain("HAVING");
    expect(bindings).toContain(1);
  });

  test("WHERE with IN", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [{ type: "in", field: "category", operator: "in", value: ["fruit", "drink"], boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("IN (?, ?)");
    expect(bindings).toEqual(["fruit", "drink"]);
  });

  test("WHERE with NOT IN", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [{ type: "in", field: "category", operator: "notIn", value: ["furniture"], boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("NOT IN (?)");
  });

  test("WHERE IS NULL", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [{ type: "null", field: "deleted_at", operator: "null", boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("IS NULL");
  });

  test("WHERE IS NOT NULL", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [{ type: "null", field: "email", operator: "notNull", boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("IS NOT NULL");
  });

  test("WHERE with nested group", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [{
        type: "nested",
        query: [
          { type: "basic", field: "a", operator: "eq", value: 1, boolean: "and" },
          { type: "basic", field: "b", operator: "eq", value: 2, boolean: "or" },
        ],
        boolean: "and",
      }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("WHERE");
    expect(sql).toContain("OR");
  });

  test("WHERE with NOT", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [{
        type: "not",
        query: [{ type: "basic", field: "status", operator: "eq", value: "banned", boolean: "and" }],
        boolean: "and",
      }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("NOT");
  });

  test("WHERE with raw clause", () => {
    const { sql, bindings } = generateSQL({
      collection: "items",
      wheres: [{ type: "raw", sql: "json_extract(data, '$.x') = ?", bindings: [1], boolean: "and" }],
      orders: [], joins: [], withs: [], unions: [],
    });
    expect(sql).toContain("json_extract");
    expect(bindings).toEqual([1]);
  });

  test("INNER JOIN with ON", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      joins: [{
        type: "inner",
        target: "categories",
        on: [{ left: "items.category_id", operator: "=", right: "categories.id" }],
      }],
    });
    expect(sql).toContain('INNER JOIN "categories"');
    expect(sql).toContain('"items"."category_id" = "categories"."id"');
  });

  test("LEFT JOIN", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      joins: [{ type: "left", target: "reviews", on: [{ left: "items.id", operator: "=", right: "reviews.item_id" }] }],
    });
    expect(sql).toContain('LEFT JOIN "reviews"');
  });

  test("CROSS JOIN", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      joins: [{ type: "cross", target: "dates" }],
    });
    expect(sql).toContain('CROSS JOIN "dates"');
  });

  test("CTE generates WITH clause", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      withs: [{
        alias: "active_items",
        query: {
          collection: "items",
          wheres: [{ type: "basic", field: "active", operator: "eq", value: 1, boolean: "and" }],
          orders: [], limit: undefined, offset: undefined,
        },
      }],
    });
    expect(sql).toContain("WITH");
    expect(sql).toContain('"active_items" AS (');
  });

  test("CTE nesting depth limit enforced", () => {
    const deepWiths = Array.from({ length: 6 }, (_, i) => ({
      alias: `lvl${i}`,
      query: {
        collection: "items",
        wheres: [] as any[],
        orders: [] as any[],
      },
    }));
    // Nest them
    for (let i = deepWiths.length - 1; i > 0; i--) {
      (deepWiths[i - 1].query as any).withs = [deepWiths[i]];
    }
    expect(() => generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [],
      withs: [deepWiths[0]],
      unions: [],
    })).toThrow("CTE nesting depth exceeds maximum");
  });

  test("UNION generates correct SQL", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      unions: [{
        type: "union",
        query: { collection: "items", wheres: [], orders: [] },
      }],
    });
    expect(sql).toContain("UNION");
  });

  test("EXCEPT generates correct SQL", () => {
    const { sql } = generateSQL({
      collection: "items",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
      unions: [{
        type: "except",
        query: { collection: "items", wheres: [], orders: [] },
      }],
    });
    expect(sql).toContain("EXCEPT");
  });

  test("validates identifiers", () => {
    expect(() => generateSQL({
      collection: "bad name!",
      wheres: [], orders: [], joins: [], withs: [], unions: [],
    })).toThrow();
  });
});

describe("compileWheresNoSearch — WhereClause[] → SQL fragment", () => {
  test("empty array returns 1=1", () => {
    const result = compileWheresNoSearch([]);
    expect(result.sql).toBe("1 = 1");
    expect(result.params).toEqual([]);
  });

  test("single eq clause", () => {
    const result = compileWheresNoSearch([
      { type: "basic", field: "name", operator: "eq", value: "Apple", boolean: "and" },
    ]);
    expect(result.sql).toBe('"name" = ?');
    expect(result.params).toEqual(["Apple"]);
  });

  test("mix of and/or produces grouped SQL", () => {
    const result = compileWheresNoSearch([
      { type: "basic", field: "a", operator: "eq", value: 1, boolean: "and" },
      { type: "basic", field: "b", operator: "eq", value: 2, boolean: "or" },
    ]);
    expect(result.params).toEqual([1, 2]);
  });
});

describe("ServerQueryBuilder — integration with real SQLite", () => {
  beforeEach(() => seed());

  test("get() returns all records", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb.get();
    expect(data.length).toBe(5);
  });

  test("where() filters records", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb.where("category", "fruit").get<Record<string, unknown>>();
    expect(data.length).toBe(2);
    expect(data[0].name).toBe("Apple");
  });

  test("first() returns first match or null", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const found = qb.where("name", "Apple").first<Record<string, unknown>>();
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Apple");

    const missing = new ServerQueryBuilder(pool.read()).from("items").where("name", "Ghost").first();
    expect(missing).toBeNull();
  });

  test("orWhere() produces OR in SQL", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb.where("category", "fruit").orWhere("price", "gt", 900).get<Record<string, unknown>>();
    expect(data.length).toBe(3); // fruits (2) + Laptop (1)
  });

  test("orderBy() sorts results", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb.orderBy("price", "desc").get<Record<string, unknown>>();
    expect(data[0].name).toBe("Laptop");
    expect(data[data.length - 1].name).toBe("Banana");
  });

  test("limit/offset pagination", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items").orderBy("price");
    const page1 = qb.clone().limit(2).get<Record<string, unknown>>();
    expect(page1.length).toBe(2);
    expect(page1[0].name).toBe("Banana"); // 0.8

    const page2 = qb.clone().limit(2).offset(2).get<Record<string, unknown>>();
    expect(page2.length).toBe(2);
    expect(page2[0].name).toBe("Mouse"); // 25
  });

  test("count() returns total", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    expect(qb.countTotal()).toBe(5);

    const filtered = qb.clone().where("category", "fruit");
    expect(filtered.countTotal()).toBe(2);
  });

  test("select() projects fields", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb.select("name", "price").orderBy("name").get<Record<string, unknown>>();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].name).toBeDefined();
    expect(data[0].price).toBeDefined();
    expect((data[0] as any).category).toBeUndefined();
  });

  test("aggregate count", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb.aggregate({ function: "$count", alias: "cnt" }).get<Record<string, unknown>>();
    expect(data[0].cnt).toBe(5);
  });

  test("groupBy with having", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const data = qb
      .aggregate({ function: "$count", alias: "cnt" })
      .groupBy("category")
      .having("cnt", "gt", 1)
      .get<Record<string, unknown>>();
    expect(data.length).toBe(2); // fruit:2, electronics:2
  });

  test("applyRLS injects WHERE clause", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    qb.applyRLS({ whereClause: '"category" = ?', params: ["fruit"] });
    const data = qb.get<Record<string, unknown>>();
    expect(data.length).toBe(2);
    expect(data.every((r: any) => r.category === "fruit")).toBe(true);
  });

  test("applyRLS with null is no-op", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    qb.applyRLS(null);
    const data = qb.get();
    expect(data.length).toBe(5);
  });

  test("paginate() returns metadata", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const result = qb.paginate<Record<string, unknown>>(1, 2);
    expect(result.data.length).toBe(2);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(2);
    expect(result.meta.total).toBe(5);
    expect(result.meta.total_pages).toBe(3);
  });

  test("clone() creates independent copy", () => {
    const qb = new ServerQueryBuilder(pool.read()).from("items");
    const cloned = qb.clone();
    cloned.where("category", "fruit");
    expect(qb.get().length).toBe(5);
    expect(cloned.get().length).toBe(2);
  });
});

describe("queryFromParams — reconstruction from wire JSON", () => {
  beforeEach(() => seed());

  test("simple fetch all", () => {
    const qb = queryFromParams({ collection: "items" }, pool.read());
    const data = qb.get();
    expect(data.length).toBe(5);
  });

  test("filter with $eq", () => {
    const qb = queryFromParams({
      collection: "items",
      filter: { category: { $eq: "fruit" } },
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data.length).toBe(2);
    expect(data[0].category).toBe("fruit");
  });

  test("filter with $and", () => {
    const qb = queryFromParams({
      collection: "items",
      filter: { $and: [{ category: "fruit" }, { price: { $gt: 1 } }] },
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Apple");
  });

  test("filter with $or", () => {
    const qb = queryFromParams({
      collection: "items",
      filter: { $or: [{ category: "drink" }, { name: { $contains: "top" } }] },
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Laptop");
  });

  test("filter with $not", () => {
    const qb = queryFromParams({
      collection: "items",
      filter: { $not: { category: "fruit" } },
    }, pool.read());
    const data = qb.get();
    expect(data.length).toBe(3);
  });

  test("sort with field/direction objects", () => {
    const qb = queryFromParams({
      collection: "items",
      sort: [{ field: "price", direction: "desc" }],
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data[0].name).toBe("Laptop");
  });

  test("field projection via select", () => {
    const qb = queryFromParams({
      collection: "items",
      fields: ["name", "price"],
      sort: [{ field: "name", direction: "asc" }],
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(Object.keys(data[0])).not.toContain("category");
  });

  test("aggregate", () => {
    const qb = queryFromParams({
      collection: "items",
      aggregate: { function: "$count", alias: "total" },
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data[0].total).toBe(5);
  });

  test("search", () => {
    const qb = queryFromParams({
      collection: "items",
      search: "apple",
      searchFields: ["name"],
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data.length).toBe(1);
  });

  test("groupBy with having", () => {
    const qb = queryFromParams({
      collection: "items",
      aggregate: { function: "$count", alias: "cnt" },
      groupBy: "category",
      having: { cnt: { $gt: 1 } },
    }, pool.read());
    const data = qb.get<Record<string, unknown>>();
    expect(data.length).toBe(2);
  });

  test("rejects missing collection", () => {
    expect(() => queryFromParams({ collection: "" } as any, pool.read())).toThrow();
  });

  test("rejects invalid collection name", () => {
    expect(() => queryFromParams({ collection: "bad name!" } as any, pool.read())).toThrow();
  });

  test("rejects raw SQL strings in join on", () => {
    expect(() => queryFromParams({
      collection: "items",
      joins: [{ target: "other", on: "1=1" }],
    } as any, pool.read())).toThrow("Raw SQL strings");
  });

  test("rejects deep filter nesting", () => {
    let filter: any = { a: 1 };
    for (let i = 0; i < 15; i++) {
      filter = { $and: [filter] };
    }
    expect(() => queryFromParams({
      collection: "items",
      filter,
    }, pool.read())).toThrow("Filter nesting exceeds maximum depth");
  });

  test("applyRLS with queryFromParams", () => {
    const qb = queryFromParams({ collection: "items" }, pool.read());
    qb.applyRLS({ whereClause: '"active" = ?', params: [1] });
    const data = qb.get();
    expect(data.length).toBe(4); // 4 active, 1 inactive
  });

  test("paginate via queryFromParams then paginate()", () => {
    const qb = queryFromParams({
      collection: "items",
      sort: [{ field: "price", direction: "asc" }],
    }, pool.read());
    const result = qb.paginate(1, 2);
    expect(result.data.length).toBe(2);
    expect(result.meta.total).toBe(5);
    expect(result.data[0].name).toBe("Banana");
  });
});
