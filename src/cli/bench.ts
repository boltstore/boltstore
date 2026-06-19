/**
 * Benchmark CLI command — measures Boltstore performance over HTTP.
 *
 * Creates a temporary database, starts an in-process server, seeds
 * configurable amounts of data, and runs latency/throughput/resource
 * benchmarks against the full stack (fetch → Bun.serve → router →
 * middleware → DatabasePool → bun:sqlite).
 *
 * Usage:
 *   boltstore bench
 *   boltstore bench --records 50000 --iterations 500
 *   boltstore bench --keep-data
 *
 * @module boltstore/cli/bench
 */

import { info, success, warn, error as cliError, out } from "../cli-style";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IS_WINDOWS = process.platform === "win32";

/** Resolve a safe temp directory that works across platforms. */
function benchTempDir(ts: number): string {
  return join(tmpdir(), `boltstore-bench-${ts}`);
}

interface BenchConfig {
  records: number;
  iterations: number;
  batchSize: number;
  concurrent: number;
  payloadKb: number;
  keepData: boolean;
}

interface BenchResult {
  name: string;
  ops: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

function parseArgs(args: string[]): BenchConfig {
  const config: BenchConfig = {
    records: 10000,
    iterations: 1000,
    batchSize: 100,
    concurrent: 1000,
    payloadKb: 100,
    keepData: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
    case "--records": if (next) { config.records = parseInt(next, 10) || config.records; i++; } break;
    case "--iterations": if (next) { config.iterations = parseInt(next, 10) || config.iterations; i++; } break;
    case "--batch-size": if (next) { config.batchSize = parseInt(next, 10) || config.batchSize; i++; } break;
    case "--concurrent": if (next) { config.concurrent = parseInt(next, 10) || config.concurrent; i++; } break;
    case "--payload-kb": if (next) { config.payloadKb = parseInt(next, 10) || config.payloadKb; i++; } break;
    case "--keep-data": config.keepData = true; break;
    }
  }

  return config;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 100) / 100}`;
  if (ms < 1000) return `${Math.round(ms * 100) / 100}`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getServerPid(port: number): number {
  try {
    if (IS_WINDOWS) {
      // netstat -ano | findstr :<port>
      const proc = Bun.spawnSync(["cmd", "/c", `netstat -ano | findstr :${port}`]);
      const line = proc.stdout.toString().split("\n").find(l => l.includes("LISTENING"));
      if (line) {
        const pid = line.trim().split(/\s+/).pop();
        return parseInt(pid || "0", 10) || 0;
      }
      return 0;
    }
    const proc = Bun.spawnSync(["lsof", "-ti", `:${port}`]);
    return parseInt(proc.stdout.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
}

interface ResourceSample {
  rssMB: number;
  cpuPct: number;
}

/**
 * Measure CPU usage as a percentage by computing the delta in user+system
 * CPU time between two samples. Returns 0-100% for a single core, >100%
 * if the process is multi-threaded across cores.
 */
async function getCpuPct(pid: number, sampleMs = 100): Promise<number> {
  if (IS_WINDOWS) return 0;
  try {
    function parseCpuSecs(out: string): number {
      const raw = out.trim();
      if (!raw) return 0;
      // macOS: "M:SS.ss" (2 parts) or "HH:MM.ss" (rare)
      // Linux: "HH:MM:SS" (3 parts) or "[DD-]HH:MM:SS"
      const parts = raw.split(":");
      if (parts.length === 3) {
        return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]) || 0;
      }
      if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]) || 0;
      }
      return parseInt(raw, 10) || 0;
    }
    function readCpuTime(): number {
      const u = Bun.spawnSync(["ps", "-o", "utime=", "-p", String(pid)]).stdout.toString();
      const s = Bun.spawnSync(["ps", "-o", "stime=", "-p", String(pid)]).stdout.toString();
      return parseCpuSecs(u) + parseCpuSecs(s);
    }
    const t0 = performance.now();
    const cpu0 = readCpuTime();
    await new Promise(r => setTimeout(r, sampleMs));
    const t1 = performance.now();
    const cpu1 = readCpuTime();
    const elapsedSec = (t1 - t0) / 1000;
    if (elapsedSec <= 0) return 0;
    return Math.round(((cpu1 - cpu0) / elapsedSec) * 10000) / 100;
  } catch {
    return 0;
  }
}

async function getResourceSample(pid: number, includeCpu = true): Promise<ResourceSample> {
  try {
    if (IS_WINDOWS) {
      // ps is not available on Windows — skip resource measurement
      return { rssMB: 0, cpuPct: 0 };
    }
    const proc = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
    const rssMB = Math.round(parseFloat(proc.stdout.toString().trim()) / 1024 * 100) / 100;
    const cpuPct = includeCpu ? await getCpuPct(pid) : 0;
    return { rssMB, cpuPct };
  } catch {
    return { rssMB: 0, cpuPct: 0 };
  }
}

/** Continuously sample RAM and CPU during a benchmark block. */
async function sampleResources(pid: number, intervalMs: number, stop: { stop: boolean }): Promise<ResourceSample[]> {
  const samples: ResourceSample[] = [];
  while (!stop.stop) {
    const s = await getResourceSample(pid);
    if (s.rssMB > 0) samples.push(s);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return samples;
}

export async function benchCommand(args: string[]): Promise<void> {
  const config = parseArgs(args);

  out("");
  info("Boltstore HTTP Benchmark");
  out(`  Records:          ${formatNum(config.records)}`);
  out(`  Iterations/test:  ${formatNum(config.iterations)}`);
  out(`  Batch size:       ${config.batchSize}`);
  out(`  Concurrent reads: ${formatNum(config.concurrent)}`);
  out(`  Large payload:    ${config.payloadKb} KB`);
  out("");

  // ── Setup: temp data dir ──────────────────────────────────────
  const ts = Date.now();
  const dataDir = benchTempDir(ts);
  mkdirSync(dataDir, { recursive: true });

  // Suppress server audit and request logs during the benchmark.
  const { setLogLevel } = await import("../logger");
  setLogLevel("error");

  const { DatabaseManager } = await import("../db/manager");
  const { createAdminUser } = await import("../auth/users");
  const { createServer, stopServerBackgroundTasks } = await import("../server");

  const manager = new DatabaseManager({ dataDir });
  const metaPool = manager.getMetaPool();
  const jwtSecret = `bench-secret-${ts}-${crypto.randomUUID()}`;

  info("Creating admin account...");
  await createAdminUser(metaPool, "bench@test.local", "BenchPass123", "Benchmark");

  // ── Start server on random port ───────────────────────────────
  const server = createServer({
    port: 0,
    manager,
    auth: { secret: jwtSecret },
    cors: { origins: ["*"], methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], headers: ["Content-Type", "Authorization"] },
    rateLimit: {
      public: 1_000_000,
      auth: 1_000_000,
      admin: 1_000_000,
      windowSeconds: 60,
    },
    requestTimeoutMs: 30000,
    maxBodySize: 100 * 1024 * 1024,
  });

  const port = server.port as number;
  const baseUrl = `http://localhost:${port}`;
  success(`Server started on ${baseUrl}`);

  // ── Helpers ───────────────────────────────────────────────────
  let adminToken = "";

  async function api(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text), text }; }
    catch { return { status: res.status, data: { _text: text }, text }; }
  }

  // ── Login ─────────────────────────────────────────────────────
  info("Logging in...");
  const login = await api("POST", "/api/_system/auth/login", { email: "bench@test.local", password: "BenchPass123" });
  adminToken = login.data?.data?.accessToken || "";

  // ── Create bench database + collections ───────────────────────
  const dbRes = await api("POST", "/api/admin/databases", { name: "bench" });
  const dbId = dbRes.data?.data?.id || "";
  info(`Bench database: ${dbId}`);

  await api("POST", `/api/admin/${dbId}/collections`, {
    name: "items",
    columns: [
      { name: "title", type: "TEXT" },
      { name: "value", type: "INTEGER" },
      { name: "active", type: "BOOLEAN" },
      { name: "category", type: "TEXT" },
      { name: "tags", type: "TEXT" },
    ],
  });

  await api("POST", `/api/admin/${dbId}/collections`, {
    name: "logs",
    columns: [
      { name: "message", type: "TEXT" },
      { name: "level", type: "TEXT" },
      { name: "source", type: "TEXT" },
      { name: "count", type: "INTEGER" },
    ],
  });

  // ── Seed data ─────────────────────────────────────────────────
  info(`Seeding ${formatNum(config.records)} records...`);
  const seedStart = performance.now();
  for (let i = 0; i < config.records; i += config.batchSize) {
    const ops: Record<string, unknown>[] = [];
    const end = Math.min(i + config.batchSize, config.records);
    for (let j = i; j < end; j++) {
      ops.push({
        action: "create",
        data: {
          title: `Item ${j}`,
          value: Math.floor(Math.random() * 100000),
          active: Math.random() > 0.3,
          category: ["electronics", "books", "food", "toys", "tools"][Math.floor(Math.random() * 5)],
          tags: ["tag-" + Math.floor(Math.random() * 20), "tag-" + Math.floor(Math.random() * 20)].join(","),
        },
      });
    }
    await api("POST", `/api/${dbId}/collections/items/records/batch`, ops);
  }
  const seedMs = Math.round(performance.now() - seedStart);
  success(`Seeded ${formatNum(config.records)} records in ${seedMs}ms (${Math.round(config.records / (seedMs / 1000))} rec/s)`);

  // ── Collect a record ID for read/update tests ─────────────────
  const firstRec = await api("GET", `/api/${dbId}/collections/items/records?limit=1`, undefined);
  const testRecordId = firstRec.data?.data?.[0]?.id || "";
  const serverPid = getServerPid(port);

  out("");

  // ═══════════════════════════════════════════════════════════════
  // BENCHMARK RUNNER
  // ═══════════════════════════════════════════════════════════════

  const results: BenchResult[] = [];
  const listIter = Math.min(200, config.iterations);
  const shortIter = Math.min(20, Math.max(5, Math.floor(config.iterations / 50)));
  const catRecIds: string[] = [];
  let viewName = "";
  let indexName = "";

  // ── Setup: dependent collections for JOINs ────────────────────
  info("Creating dependent collections for complex benchmarks...");
  await api("POST", `/api/admin/${dbId}/collections`, {
    name: "categories",
    columns: [{ name: "name", type: "TEXT" }],
  });
  for (let i = 0; i < 20; i++) {
    const r = await api("POST", `/api/${dbId}/collections/categories/records`, {
      name: ["electronics", "books", "food", "toys", "tools"][i % 5],
    });
    if (r.data?.data?.id) catRecIds.push(r.data.data.id);
  }

  await api("POST", `/api/admin/${dbId}/collections`, {
    name: "products",
    columns: [
      { name: "name", type: "TEXT" },
      { name: "category_id", type: "TEXT" },
      { name: "price", type: "INTEGER" },
    ],
  });
  const prodOps: Record<string, unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    prodOps.push({
      action: "create",
      data: {
        name: `Product ${i}`,
        category_id: catRecIds[i % catRecIds.length],
        price: Math.floor(Math.random() * 10000),
      },
    });
  }
  await api("POST", `/api/${dbId}/collections/products/records/batch`, prodOps.slice(0, 50));
  await api("POST", `/api/${dbId}/collections/products/records/batch`, prodOps.slice(50));

  // ── Setup: view + index for their benchmarks ──────────────────
  await api("POST", `/api/admin/${dbId}/views`, {
    name: "bench_active_products",
    sql: "SELECT p.name, p.price, c.name AS category FROM products p JOIN categories c ON p.category_id = c.id WHERE p.price > 1000",
  });
  viewName = "bench_active_products";

  await api("POST", `/api/admin/${dbId}/collections/items/indexes`, {
    name: "bench_idx_items_category_value",
    columns: ["category", "value"],
    unique: false,
  });
  indexName = "bench_idx_items_category_value";

  const benchTotal = 11;

  async function bench(label: string, iterations: number, fn: () => Promise<void>): Promise<BenchResult> {
    const durations: number[] = [];
    for (let w = 0; w < Math.min(5, iterations); w++) {
      try { await fn(); } catch {}
    }
    const totalStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      try { await fn(); } catch {}
      durations.push(performance.now() - t0);
    }
    const totalMs = Math.round(performance.now() - totalStart);
    const sorted = [...durations].sort((a, b) => a - b);
    const avgMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 100) / 100;
    return {
      name: label,
      ops: iterations,
      totalMs,
      avgMs: Math.round(avgMs * 100) / 100,
      p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
      p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
      p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
      minMs: Math.round(sorted[0] * 100) / 100,
      maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
      opsPerSec: Math.round(iterations / (totalMs / 1000)),
    };
  }

  // ── 1. CRUD Latency ───────────────────────────────────────────
  info(`Bench 1/${benchTotal}: CRUD Latency`);

  results.push(await bench("POST create record", config.iterations, async () => {
    await api("POST", `/api/${dbId}/collections/items/records`, {
      title: "Bench", value: 42, active: true, category: "tools", tags: "bench",
    });
  }));
  results.push(await bench("GET record by ID", config.iterations, async () => {
    await api("GET", `/api/${dbId}/collections/items/records/${testRecordId}`);
  }));
  results.push(await bench("PATCH update record", config.iterations, async () => {
    await api("PATCH", `/api/${dbId}/collections/items/records/${testRecordId}`, {
      value: Math.floor(Math.random() * 1000),
    });
  }));
  const delIter = Math.min(500, config.iterations);
  results.push(await bench("DELETE + CREATE record", delIter, async () => {
    const c = await api("POST", `/api/${dbId}/collections/items/records`, {
      title: "Temp", value: 1, active: true, category: "food", tags: "tmp",
    });
    if (c.data?.data?.id) await api("DELETE", `/api/${dbId}/collections/items/records/${c.data.data.id}`);
  }));

  // ── 2. List & Pagination ──────────────────────────────────────
  info(`Bench 2/${benchTotal}: List & Pagination`);

  results.push(await bench("GET list (no filter)", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records?limit=50`);
  }));
  results.push(await bench("GET list (filtered)", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records?limit=50&active=true&category=electronics`);
  }));
  results.push(await bench("GET list (sorted)", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records?sort=value&direction=desc&limit=50`);
  }));
  results.push(await bench("GET list (page/per_page)", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records?page=1&per_page=20`);
  }));
  results.push(await bench("GET count", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records/count`);
  }));
  results.push(await bench("GET count (filtered)", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records/count?active=true`);
  }));
  results.push(await bench("GET distinct", listIter, async () => {
    await api("GET", `/api/${dbId}/collections/items/records/distinct?field=category`);
  }));

  // ── 3. Query API ──────────────────────────────────────────────
  info(`Bench 3/${benchTotal}: Query API`);

  results.push(await bench("POST /query (basic filter)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", filter: { active: "true" }, limit: 50,
    });
  }));
  results.push(await bench("POST /query (search)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", search: "Item 500", limit: 50,
    });
  }));
  results.push(await bench("POST /query ($and/$or filter)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items",
      filter: { $and: [{ category: "electronics" }, { $or: [{ value: { $gt: "100" } as any }, { value: { $lt: "50" } as any }] }] },
      limit: 50,
    });
  }));
  results.push(await bench("POST /query ($gt/$lt filter)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items",
      filter: { value: { $gt: "100" } as any, active: "true" },
      limit: 50,
    });
  }));
  results.push(await bench("POST /query ($in filter)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items",
      filter: { category: { $in: ["electronics", "books"] } as any },
      limit: 50,
    });
  }));
  results.push(await bench("POST /query (fields projection)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", fields: ["title", "value", "category"], limit: 50,
    });
  }));
  results.push(await bench("POST /query ($count aggregate)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", aggregate: { function: "$count", alias: "total" },
    });
  }));
  results.push(await bench("POST /query ($sum aggregate)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", aggregate: { function: "$sum", field: "value", alias: "sum_val" },
    });
  }));
  results.push(await bench("POST /query ($avg aggregate)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", aggregate: { function: "$avg", field: "value", alias: "avg_val" },
    });
  }));
  results.push(await bench("POST /query ($min aggregate)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", aggregate: { function: "$min", field: "value", alias: "min_val" },
    });
  }));
  results.push(await bench("POST /query (groupBy)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items", aggregate: { function: "$count", alias: "cnt" }, groupBy: "category",
    });
  }));
  results.push(await bench("POST /query (groupBy + having)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items",
      aggregate: { function: "$count", alias: "cnt" },
      groupBy: "category",
      having: { cnt: { $gt: "1" } as any },
    });
  }));

  // ── 4. Admin SQL ──────────────────────────────────────────────
  info(`Bench 4/${benchTotal}: Admin SQL`);

  results.push(await bench("Admin SELECT (basic)", listIter, async () => {
    await api("POST", `/api/admin/${dbId}/query`, {
      sql: "SELECT title, value FROM items WHERE active = 1 LIMIT 50",
    });
  }));
  results.push(await bench("Admin SELECT (JOIN)", listIter, async () => {
    await api("POST", `/api/admin/${dbId}/query`, {
      sql: "SELECT p.name, p.price, c.name AS category FROM products p JOIN categories c ON p.category_id = c.id LIMIT 50",
    });
  }));
  results.push(await bench("Admin SELECT (subquery)", listIter, async () => {
    await api("POST", `/api/admin/${dbId}/query`, {
      sql: "SELECT title, value FROM items WHERE value > (SELECT AVG(value) FROM items) LIMIT 50",
    });
  }));
  results.push(await bench("Admin SELECT (aggregate)", listIter, async () => {
    await api("POST", `/api/admin/${dbId}/query`, {
      sql: "SELECT category, COUNT(*) as cnt, AVG(value) as avg_val FROM items GROUP BY category",
    });
  }));
  results.push(await bench("Admin INSERT", listIter, async () => {
    const rnd = Math.random().toString(36).slice(2, 8);
    await api("POST", `/api/admin/${dbId}/query/write`, {
      sql: "INSERT INTO items (id, title, value, active, category, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      params: [`rec_bench_${rnd}`, "Admin", 999, 1, "tools", "admin"],
    });
  }));
  results.push(await bench("Admin UPDATE", listIter, async () => {
    await api("POST", `/api/admin/${dbId}/query/write`, {
      sql: `UPDATE items SET value = value + 1 WHERE id = ?`, params: [testRecordId],
    });
  }));
  results.push(await bench("Admin DELETE + re-INSERT", shortIter, async () => {
    const rnd = Math.random().toString(36).slice(2, 8);
    await api("POST", `/api/admin/${dbId}/query/write`, {
      sql: "DELETE FROM items WHERE id = ?", params: [`rec_bench_${rnd}`],
    });
  }));
  results.push(await bench("Admin EXPLAIN", listIter, async () => {
    await api("POST", `/api/admin/${dbId}/query/explain`, {
      sql: "SELECT * FROM items WHERE category = ? AND active = 1 ORDER BY value DESC LIMIT 50",
      params: ["electronics"],
    });
  }));

  // ── 5. Transactions ───────────────────────────────────────────
  info(`Bench 5/${benchTotal}: Transactions`);

  results.push(await bench("Transaction (1 SELECT + 1 INSERT)", shortIter, async () => {
    await api("POST", `/api/admin/${dbId}/transactions`, {
      operations: [
        { sql: "SELECT COUNT(*) as cnt FROM items" },
        { sql: "INSERT INTO items (id, title, value, active, category, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))", params: [`rec_txn_${Math.random().toString(36).slice(2, 8)}`, "Txn", 1, 1, "tools", "txn"] },
      ],
    });
  }));
  results.push(await bench("Transaction (3 ops: SELECT + INSERT + UPDATE)", shortIter, async () => {
    const rnd = Math.random().toString(36).slice(2, 8);
    await api("POST", `/api/admin/${dbId}/transactions`, {
      operations: [
        { sql: "SELECT COUNT(*) as cnt FROM items WHERE category = ?", params: ["tools"] },
        { sql: "INSERT INTO items (id, title, value, active, category, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))", params: [`rec_txn3_${rnd}`, "Txn3", 100, 1, "tools", "txn3"] },
        { sql: "UPDATE items SET value = value + 1 WHERE id = ?", params: [testRecordId] },
      ],
    });
  }));

  // ── 6. Views ──────────────────────────────────────────────────
  info(`Bench 6/${benchTotal}: Views`);

  results.push(await bench("GET view metadata", listIter, async () => {
    await api("GET", `/api/admin/${dbId}/views/${viewName}`);
  }));
  results.push(await bench("GET query view", listIter, async () => {
    await api("GET", `/api/admin/${dbId}/views/${viewName}?query=true&limit=20`);
  }));

  // ── 7. Indexes ────────────────────────────────────────────────
  info(`Bench 7/${benchTotal}: Indexes`);

  results.push(await bench("GET list indexes", listIter, async () => {
    await api("GET", `/api/admin/${dbId}/collections/items/indexes`);
  }));
  results.push(await bench("POST /query (indexed sort)", listIter, async () => {
    await api("POST", `/api/${dbId}/query`, {
      collection: "items",
      filter: { category: "tools" },
      sort: ["value:desc"],
      limit: 50,
    });
  }));

  // ── 8. Import & Export ────────────────────────────────────────
  info(`Bench 8/${benchTotal}: Import & Export`);

  results.push(await bench("GET export JSON", shortIter, async () => {
    await api("GET", `/api/admin/${dbId}/collections/items/export?format=json&limit=100`);
  }));
  results.push(await bench("GET export CSV", shortIter, async () => {
    await api("GET", `/api/admin/${dbId}/collections/items/export?format=csv&limit=100`);
  }));
  const csvPayload = "title,value,active,category,tags\n" + Array.from({ length: 20 }, (_, i) => `BenchImport-${i},${i * 10},true,tools,bench`).join("\n");
  results.push(await bench("POST import CSV (20 rows)", shortIter, async () => {
    await api("POST", `/api/admin/${dbId}/collections/items/import`, {
      data: csvPayload, format: "csv", autoCreate: false, hasHeader: true,
    });
  }));

  // ── 9. Batch Operations ───────────────────────────────────────
  const batchIter = Math.min(50, Math.max(10, Math.floor(config.iterations / 20)));
  info(`Bench 9/${benchTotal}: Batch Operations`);

  const batchOps: Record<string, unknown>[] = [];
  for (let i = 0; i < config.batchSize; i++) {
    batchOps.push({
      action: "create",
      data: { title: `Batch-${i}`, value: i * 10, active: i % 2 === 0, category: "tools", tags: `batch,test-${i % 10}` },
    });
  }
  results.push(await bench(`Batch create ${config.batchSize} records`, batchIter, async () => {
    await api("POST", `/api/${dbId}/collections/items/records/batch`, batchOps);
  }));

  const mixedBatchOps: Record<string, unknown>[] = [];
  mixedBatchOps.push({ action: "create", data: { title: "MixedCreate", value: 1, active: true, category: "tools", tags: "mixed" } });
  const updateId = testRecordId;
  mixedBatchOps.push({ action: "update", id: updateId, data: { value: Math.floor(Math.random() * 1000) } });
  results.push(await bench("Batch mixed (create + update)", shortIter, async () => {
    await api("POST", `/api/${dbId}/collections/items/records/batch`, mixedBatchOps);
  }));

  // ── 10. Concurrent ─────────────────────────────────────────────
  info(`Bench 10/${benchTotal}: Concurrent Throughput`);

  // Fire requests in waves to avoid overwhelming Bun's HTTP client
  // and the OS connection limit. Each wave runs up to CONCURRENT_WAVE
  // requests with a 5-second timeout, then the next wave starts.
  const CONCURRENT_WAVE = 100;

  async function runConcurrent(totalOps: number, buildFetch: (i: number) => () => Promise<void>): Promise<number> {
    const start = performance.now();
    let completed = 0;
    while (completed < totalOps) {
      const batch = Math.min(CONCURRENT_WAVE, totalOps - completed);
      const wave: Promise<void>[] = [];
      for (let j = 0; j < batch; j++) {
        wave.push(buildFetch(completed + j)());
      }
      await Promise.all(wave);
      completed += batch;
    }
    return Math.round(performance.now() - start);
  }

  let concErrors = 0;
  const concTotal = await runConcurrent(config.concurrent, (i) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    return async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
        const res = await fetch(`${baseUrl}/api/${dbId}/collections/items/records?limit=1&offset=${i % config.records}`, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        await res.text();
      } catch {
        concErrors++;
      } finally {
        clearTimeout(timer);
      }
    };
  });
  if (concErrors > 0) warn(`${concErrors} concurrent read requests failed (connection limit likely reached — try reducing --concurrent)`);
  results.push({
    name: `GET ${formatNum(config.concurrent)} concurrent reads`,
    ops: config.concurrent,
    totalMs: concTotal,
    avgMs: Math.round(concTotal / config.concurrent * 100) / 100,
    p50Ms: 0, p95Ms: 0, p99Ms: 0, minMs: 0, maxMs: 0,
    opsPerSec: Math.round(config.concurrent / (concTotal / 1000)),
  });

  const concWrites = Math.min(200, config.concurrent);
  let concWriteErrors = 0;
  const concWriteTotal = await runConcurrent(concWrites, (i) => {
    const rnd = Math.random().toString(36).slice(2, 8);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    return async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
        const res = await fetch(`${baseUrl}/api/admin/${dbId}/query/write`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sql: "INSERT INTO logs (id, message, level, source, count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
            params: [`rec_log_${rnd}`, `Log entry ${i}`, "info", "bench", 1],
          }),
          signal: controller.signal,
        });
        await res.text();
      } catch {
        concWriteErrors++;
      } finally {
        clearTimeout(timer);
      }
    };
  });
  if (concWriteErrors > 0) warn(`${concWriteErrors} concurrent write requests failed`);
  results.push({
    name: `POST ${formatNum(concWrites)} concurrent writes`,
    ops: concWrites,
    totalMs: concWriteTotal,
    avgMs: Math.round(concWriteTotal / concWrites * 100) / 100,
    p50Ms: 0, p95Ms: 0, p99Ms: 0, minMs: 0, maxMs: 0,
    opsPerSec: Math.round(concWrites / (concWriteTotal / 1000)),
  });

  // ── 11. Resource Usage ─────────────────────────────────────────
  info(`Bench 11/${benchTotal}: Resource Usage`);

  if (serverPid && !IS_WINDOWS) {
    // Measure baseline before load
    const baseline = await getResourceSample(serverPid, false);
    out(`  Baseline (${formatNum(config.records)} records): ${baseline.rssMB} MB`);

    // Run sustained writes while sampling
    const memStop = { stop: false };
    const resPromise = sampleResources(serverPid, 250, memStop);

    const resourceStart = performance.now();
    for (let wave = 0; wave < 8; wave++) {
      const wavePromises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        wavePromises.push((async () => {
          try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
            await fetch(`${baseUrl}/api/${dbId}/collections/items/records`, {
              method: "POST",
              headers,
              body: JSON.stringify({ title: `Mem ${wave * 100 + i}`, value: i, active: true, category: "tools", tags: "mem" }),
              signal: controller.signal,
            });
          } catch {} finally { clearTimeout(timer); }
        })());
      }
      await Promise.all(wavePromises);
    }
    memStop.stop = true;
    const resourceMs = Math.round(performance.now() - resourceStart);
    const samples = await resPromise;

    if (samples.length > 0) {
      const rssVals = samples.map(s => s.rssMB).sort((a, b) => a - b);
      const cpuVals = samples.map(s => s.cpuPct).sort((a, b) => a - b);
      const rssMin = rssVals[0];
      const rssMax = rssVals[rssVals.length - 1];
      const rssAvg = Math.round(rssVals.reduce((a, b) => a + b, 0) / rssVals.length * 100) / 100;
      const cpuMin = cpuVals[0];
      const cpuMax = cpuVals[cpuVals.length - 1];
      const cpuAvg = Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length * 100) / 100;

      out(`  RAM under load: min ${rssMin} MB / avg ${rssAvg} MB / max ${rssMax} MB`);
      out(`  CPU under load: min ${cpuMin}% / avg ${cpuAvg}% / max ${cpuMax}%`);
      out(`  (${samples.length} samples over ${resourceMs}ms, ${Math.round(800 / (resourceMs / 1000))} writes/sec)`);
    }
  } else if (IS_WINDOWS) {
    out("  (Resource measurement not available on Windows)");
  } else {
    out("  (Could not determine server PID — skipping resource measurement)");
  }

  // ── 12. Auth ───────────────────────────────────────────────────
  info(`Bench Auth`);

  results.push(await bench("POST auth/register (bcrypt)", 50, async () => {
    const email = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    await api("POST", `/api/${dbId}/auth/register`, { email, password: "BenchPass123" });
  }));
  results.push(await bench("POST auth/login (fail)", 200, async () => {
    await api("POST", `/api/${dbId}/auth/login`, {
      email: `bench-${Math.random().toString(36).slice(2, 8)}@test.local`,
      password: "WrongPass123",
    });
  }));

  out("");

  // ═══════════════════════════════════════════════════════════════
  // REPORT
  // ═══════════════════════════════════════════════════════════════

  out("╔══════════════════════════════════════════════════════════════╗");
  out("║                   BENCHMARK RESULTS                          ║");
  out("╚══════════════════════════════════════════════════════════════╝");
  out("");

  const nameW = 38;

  // Table header
  const hdr = `│ ${"Operation".padEnd(nameW)} │ ${"ops".padStart(7)} │ ${"avg".padStart(8)} │ ${"p95".padStart(8)} │ ${"ops/sec".padStart(10)} │`;
  const sep = "├" + "─".repeat(nameW + 2) + "┼" + "─".repeat(9) + "┼" + "─".repeat(10) + "┼" + "─".repeat(10) + "┼" + "─".repeat(12) + "┤";

  out(sep);
  out(`│ ${"Operation".padEnd(nameW)} │ ${"ops".padStart(7)} │ ${"avg".padStart(8)} │ ${"p95".padStart(8)} │ ${"ops/sec".padStart(10)} │`);
  out(sep);

  for (const r of results) {
    const name = r.name.length > nameW ? r.name.slice(0, nameW - 1) + "…" : r.name;
    out(`│ ${name.padEnd(nameW)} │ ${String(r.ops).padStart(7)} │ ${(r.avgMs + "ms").padStart(8)} │ ${(r.p95Ms + "ms").padStart(8)} │ ${String(r.opsPerSec).padStart(10)} │`);
  }

  out(sep);
  out("");

  // Summary stats
  const crudResults = results.filter(r => ["POST create record", "GET record by ID", "PATCH update record"].includes(r.name));
  if (crudResults.length > 0) {
    const crudAvg = Math.round(crudResults.reduce((a, r) => a + r.avgMs, 0) / crudResults.length * 100) / 100;
    success(`CRUD average: ${crudAvg}ms`);
  }

  success(`Data seeded: ${formatNum(config.records)} records`);
  if (results.length > 0) {
    const fastest = results.reduce((a, b) => a.avgMs < b.avgMs ? a : b);
    const slowest = results.reduce((a, b) => a.avgMs > b.avgMs ? a : b);
    info(`Fastest: ${fastest.name} (${fastest.avgMs}ms)`);
    info(`Slowest: ${slowest.name} (${slowest.avgMs}ms)`);
  }

  // ── Cleanup ───────────────────────────────────────────────────
  out("");
  info("Stopping server...");
  stopServerBackgroundTasks();
  server.stop();
  manager.close();

  if (config.keepData) {
    warn(`Temp data kept at: ${dataDir}`);
  } else {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    info("Temp data cleaned up.");
  }

  success("Benchmark complete.");

  // Flush any remaining buffered logs, then exit. Bun's event loop
  // may keep the process alive due to pending queueMicrotask callbacks
  // in the logger flush pipeline.
  const { flushLogger } = await import("../logger");
  await flushLogger();
  process.exit(0);
}
