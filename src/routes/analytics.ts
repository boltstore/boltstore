import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { AnalyticsManager } from "../analytics";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";

export function recordAnalytics(manager: DatabaseManager, event: {
  database: string;
  table?: string;
  operation: string;
  durationMs: number;
  rowCount: number;
  status: string;
  errorMessage?: string;
}): void {
  const a = manager.getAnalytics();
  if (a) a.recordQuery(event);
}

function parseRange(url: URL): { since: string; groupFmt: string } {
  const range = url.searchParams.get("range") || "24h";
  switch (range) {
    case "7d": return { since: "-7 days", groupFmt: "'%Y-%m-%d'" };
    case "30d": return { since: "-30 days", groupFmt: "'%Y-%W'" };
    default: return { since: "-1 day", groupFmt: "'%H'" };
  }
}

export function registerAnalyticsRoutes(router: Router, manager: DatabaseManager, analytics: AnalyticsManager): void {
  const pool = analytics.getPool();

  router.get("/api/analytics/overview", async (req) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();

    const queries = (db.query(
      `SELECT COUNT(*) as c, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes FROM _query_log WHERE timestamp >= datetime('now', ?)`
    ).get(since) as any) ?? { c: 0, avg_ms: 0, errors: 0, writes: 0 };

    const totalStorage = (db.query(
      "SELECT COALESCE(SUM(size_bytes), 0) as total FROM _storage_snapshots WHERE id IN (SELECT MAX(id) FROM _storage_snapshots GROUP BY database)"
    ).get() as any)?.total ?? 0;

    const dbCount = manager.listDatabases().length;

    return jsonResponse({
      data: {
        databases: dbCount,
        queries: queries.c,
        writes: queries.writes,
        avgLatencyMs: Math.round(queries.avg_ms * 10) / 10,
        errorCount: queries.errors,
        totalStorageBytes: totalStorage,
      },
    });
  });

  router.get("/api/analytics/:database/overview", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();

    const queries = (db.query(
      `SELECT COUNT(*) as c, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?)`
    ).get(params.database, since) as any) ?? { c: 0, avg_ms: 0, errors: 0, writes: 0 };

    const storage = (db.query(
      "SELECT size_bytes, table_count FROM _storage_snapshots WHERE database = ? ORDER BY timestamp DESC LIMIT 1"
    ).get(params.database) as any) ?? { size_bytes: 0, table_count: 0 };

    const topTables = db.query(
      `SELECT table_name, COUNT(*) as calls, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes FROM _query_log WHERE database = ? AND table_name IS NOT NULL AND timestamp >= datetime('now', ?) GROUP BY table_name ORDER BY calls DESC LIMIT 10`
    ).all(params.database, since) as any[];

    return jsonResponse({
      data: {
        database: params.database,
        queries: queries.c,
        writes: queries.writes,
        avgLatencyMs: Math.round(queries.avg_ms * 10) / 10,
        errorCount: queries.errors,
        storageBytes: storage.size_bytes,
        tableCount: storage.table_count,
        topTables,
      },
    });
  });

  router.get("/api/analytics/:database/queries", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const db = pool.read();

    const total = (db.query("SELECT COUNT(*) as c FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?)").get(params.database, since) as any)?.c ?? 0;
    const rows = db.query(
      "SELECT id, database, table_name, operation, duration_ms, row_count, status, error_msg, timestamp FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?) ORDER BY id DESC LIMIT ? OFFSET ?"
    ).all(params.database, since, limit, offset);

    return jsonResponse({ data: rows, meta: { total, limit, offset } });
  });

  router.get("/api/analytics/:database/size", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const db = pool.read();
    const rows = db.query(
      "SELECT size_bytes, table_count, timestamp FROM _storage_snapshots WHERE database = ? ORDER BY timestamp DESC LIMIT 100"
    ).all(params.database);
    return jsonResponse({ data: rows });
  });

  router.get("/api/analytics/top-queries", async (req) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();
    const rows = db.query(
      `SELECT database, table_name, operation, COUNT(*) as calls, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(row_count), 0) as total_rows FROM _query_log WHERE timestamp >= datetime('now', ?) GROUP BY database, table_name, operation ORDER BY calls DESC LIMIT 20`
    ).all(since);
    return jsonResponse({ data: rows });
  });

  router.get("/api/analytics/errors", async (req) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const db = pool.read();
    const rows = db.query(
      "SELECT id, database, table_name, operation, duration_ms, row_count, error_msg, timestamp FROM _query_log WHERE status = 'error' AND timestamp >= datetime('now', ?) ORDER BY id DESC LIMIT ?"
    ).all(since, limit);
    return jsonResponse({ data: rows });
  });

  router.get("/api/analytics/volume", async (req) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const range = url.searchParams.get("range") || "24h";
    const { since, groupFmt } = parseRange(url);
    const db = pool.read();
    const rows = db.query(
      `SELECT strftime(${groupFmt}, timestamp) as slot, COUNT(*) as count, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors FROM _query_log WHERE timestamp >= datetime('now', ?) GROUP BY slot ORDER BY slot`
    ).all(since) as { slot: string; count: number; errors: number }[];
    const lookup: Record<string, number> = {};
    const errorLookup: Record<string, number> = {};
    for (const r of rows) { lookup[r.slot] = r.count; errorLookup[r.slot] = r.errors; }

    const now = new Date();
    let slots: string[];
    if (range === "7d") {
      slots = [];
      const end = new Date(now);
      end.setUTCDate(end.getUTCDate() + 1);
      for (let i = 7; i >= 0; i--) {
        const d = new Date(end);
        d.setUTCDate(d.getUTCDate() - i);
        slots.push(d.toISOString().slice(0, 10));
      }
    } else if (range === "30d") {
      const dayRows = db.query(
        `SELECT strftime('%Y-%m-%d', timestamp) as day, COUNT(*) as count, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors FROM _query_log WHERE timestamp >= datetime('now', ?) GROUP BY day ORDER BY day`
      ).all("-30 days") as { day: string; count: number; errors: number }[];
      const dayLookup: Record<string, number> = {};
      const dayErrorLookup: Record<string, number> = {};
      for (const r of dayRows) { dayLookup[r.day] = r.count; dayErrorLookup[r.day] = r.errors; }
      slots = [];
      const end = new Date(now);
      end.setUTCDate(end.getUTCDate() + 7);
      const endSunday = new Date(end);
      endSunday.setUTCDate(endSunday.getUTCDate() - endSunday.getUTCDay());
      for (let i = 4; i >= 0; i--) {
        const d = new Date(endSunday);
        d.setUTCDate(d.getUTCDate() - i * 7);
        slots.push(d.toISOString().slice(0, 10));
      }
      const counts = slots.map(s => {
        let total = 0;
        const d = new Date(s + "T00:00:00Z");
        for (let j = 0; j < 7; j++) {
          const dayStr = d.toISOString().slice(0, 10);
          total += dayLookup[dayStr] || 0;
          d.setUTCDate(d.getUTCDate() + 1);
        }
        return total;
      });
      const errors = slots.map(s => {
        let total = 0;
        const d = new Date(s + "T00:00:00Z");
        for (let j = 0; j < 7; j++) {
          const dayStr = d.toISOString().slice(0, 10);
          total += dayErrorLookup[dayStr] || 0;
          d.setUTCDate(d.getUTCDate() + 1);
        }
        return total;
      });
      const max = Math.max(...counts, 1);
      return jsonResponse({ data: { slots, counts, errors, max } });
    } else {
      slots = [];
      const endHour = now.getUTCHours() + 1;
      for (let i = 24; i >= 0; i--) {
        slots.push(String((endHour - i + 24) % 24).padStart(2, "0"));
      }
    }

    const counts = slots.map(s => lookup[s] || 0);
    const errors = slots.map(s => errorLookup[s] || 0);
    const max = Math.max(...counts, 1);
    return jsonResponse({ data: { slots, counts, errors, max } });
  });
}
