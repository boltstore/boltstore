import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { AnalyticsManager } from "../analytics";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";

interface QueryStatsRow { c: number; avg_ms: number; errors: number; writes: number }
interface StorageTotalRow { total: number }
interface StorageRow { size_bytes: number; table_count: number }
interface TopTableRow { sql_text: string | null; calls: number; avg_ms: number; writes: number; total_rows: number }
interface CountRow { c: number }

export function recordAnalytics(manager: DatabaseManager, event: {
  database: string;
  table?: string;
  operation: string;
  durationMs: number;
  rowCount: number;
  status: string;
  errorMessage?: string;
  sqlText?: string;
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

function getTzOffsetMinutes(tz: string): number {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const p = (type: string) => parseInt(parts.find(x => x.type === type)?.value || "0", 10);
    const localMs = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"));
    const utcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes());
    return (localMs - utcMs) / 60000;
  } catch { return 0; }
}

function getTzDate(tz: string): Date {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const p = (type: string) => parseInt(parts.find(x => x.type === type)?.value || "0", 10);
    return new Date(Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second")));
  } catch { return new Date(); }
}

function getTzSign(tz: string): string {
  const offset = getTzOffsetMinutes(tz);
  if (offset === 0) return "";
  const totalMinutes = Math.abs(offset);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const sign = offset > 0 ? "+" : "-";
  return minutes > 0 ? `${sign}${hours} hours ${minutes} minutes` : `${sign}${hours} hours`;
}

export function registerAnalyticsRoutes(router: Router, manager: DatabaseManager, analytics: AnalyticsManager): void {
  const pool = analytics.getPool();

  router.get("/api/analytics/overview", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();

    const queries = (db.query(
      `SELECT COUNT(*) as c, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as rows_read, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as rows_written FROM _query_log WHERE timestamp >= datetime('now', ?)`
    ).get(since) as QueryStatsRow & { rows_read: number; rows_written: number }) ?? { c: 0, avg_ms: 0, errors: 0, writes: 0, rows_read: 0, rows_written: 0 };

    const totalStorage = (db.query(
      "SELECT COALESCE(SUM(size_bytes), 0) as total FROM _storage_snapshots WHERE id IN (SELECT MAX(id) FROM _storage_snapshots GROUP BY database)"
    ).get() as StorageTotalRow)?.total ?? 0;

    const dbCount = manager.listDatabases().length;

    return jsonResponse({
      data: {
        databases: dbCount,
        queries: queries.c,
        writes: queries.writes,
        avgLatencyMs: Math.round(queries.avg_ms * 10) / 10,
        errorCount: queries.errors,
        rows_read: queries.rows_read,
        rows_written: queries.rows_written,
        totalStorageBytes: totalStorage,
      },
    });
  });

  router.get("/api/analytics/:database/overview", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();

    const queries = (db.query(
      `SELECT COUNT(*) as c, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes, COALESCE(SUM(row_count), 0) as rows_read FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?)`
    ).get(params.database, since) as QueryStatsRow & { rows_read: number }) ?? { c: 0, avg_ms: 0, errors: 0, writes: 0, rows_read: 0 };

    const storage = (db.query(
      "SELECT size_bytes, table_count FROM _storage_snapshots WHERE database = ? ORDER BY timestamp DESC LIMIT 1"
    ).get(params.database) as StorageRow) ?? { size_bytes: 0, table_count: 0 };

    const topTables = db.query(
      `SELECT COALESCE(sql_text, operation) as sql_text, COUNT(*) as calls, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes, COALESCE(SUM(row_count), 0) as total_rows FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?) GROUP BY COALESCE(sql_text, operation) ORDER BY calls DESC LIMIT 10`
    ).all(params.database, since) as TopTableRow[];

    return jsonResponse({
      data: {
        database: params.database,
        queries: queries.c,
        writes: queries.writes,
        avgLatencyMs: Math.round(queries.avg_ms * 10) / 10,
        errorCount: queries.errors,
        rows_read: queries.rows_read,
        storageBytes: storage.size_bytes,
        tableCount: storage.table_count,
        topTables,
      },
    });
  });

  router.get("/api/analytics/:database/queries", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const db = pool.read();

    const total = (db.query("SELECT COUNT(*) as c FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?)").get(params.database, since) as CountRow)?.c ?? 0;
    const rows = db.query(
      "SELECT id, database, table_name, operation, duration_ms, row_count, status, error_msg, timestamp FROM _query_log WHERE database = ? AND timestamp >= datetime('now', ?) ORDER BY id DESC LIMIT ? OFFSET ?"
    ).all(params.database, since, limit, offset);

    return jsonResponse({ data: rows, meta: { total, limit, offset } });
  });

  router.get("/api/analytics/:database/size", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const db = pool.read();
    const rows = db.query(
      "SELECT size_bytes, table_count, timestamp FROM _storage_snapshots WHERE database = ? ORDER BY timestamp DESC LIMIT 100"
    ).all(params.database);
    return jsonResponse({ data: rows });
  });

  router.get("/api/analytics/top-queries", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();
    const rows = db.query(
      `SELECT database, sql_text, calls, avg_ms, total_rows FROM (SELECT database, COALESCE(sql_text, operation) as sql_text, COUNT(*) as calls, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(row_count), 0) as total_rows, ROW_NUMBER() OVER (PARTITION BY database ORDER BY COUNT(*) DESC) as rn FROM _query_log WHERE timestamp >= datetime('now', ?) GROUP BY database, COALESCE(sql_text, operation)) WHERE rn = 1 ORDER BY calls DESC`
    ).all(since);
    return jsonResponse({ data: rows });
  });

  router.get("/api/analytics/errors", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
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
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const range = url.searchParams.get("range") || "24h";
    const { since, groupFmt } = parseRange(url);
    const db = pool.read();

    const metaRow = manager.getMetaPool().read().query("SELECT value FROM _meta WHERE key = 'global_settings'").get() as { value: string } | null;
    const settings = metaRow ? { timezone: "UTC", ...JSON.parse(metaRow.value) } : { timezone: "UTC" };
    const tzAdj = getTzSign(settings.timezone);

    const sinceExpr = tzAdj ? `datetime('now', '${tzAdj}', ${since})` : `datetime('now', ${since})`;
    const tzTimestamp = tzAdj ? `datetime(timestamp, '${tzAdj}')` : "timestamp";
    const rows = db.query(
      `SELECT strftime(${groupFmt}, ${tzTimestamp}) as slot, COUNT(*) as count, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as rows_read, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as rows_written FROM _query_log WHERE ${tzTimestamp} >= ${sinceExpr} GROUP BY slot ORDER BY slot`
    ).all() as { slot: string; count: number; errors: number; rows_read: number; rows_written: number }[];
    const lookup: Record<string, number> = {};
    const errorLookup: Record<string, number> = {};
    const rowsReadLookup: Record<string, number> = {};
    const rowsWrittenLookup: Record<string, number> = {};
    for (const r of rows) { lookup[r.slot] = r.count; errorLookup[r.slot] = r.errors; rowsReadLookup[r.slot] = r.rows_read; rowsWrittenLookup[r.slot] = r.rows_written; }

    const now = getTzDate(settings.timezone);
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
        `SELECT strftime('%Y-%m-%d', ${tzTimestamp}) as day, COUNT(*) as count, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as rows_read, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as rows_written FROM _query_log WHERE ${tzTimestamp} >= ${sinceExpr} GROUP BY day ORDER BY day`
      ).all() as { day: string; count: number; errors: number; rows_read: number; rows_written: number }[];
      const dayLookup: Record<string, number> = {};
      const dayErrorLookup: Record<string, number> = {};
      const dayReadLookup: Record<string, number> = {};
      const dayWriteLookup: Record<string, number> = {};
      for (const r of dayRows) { dayLookup[r.day] = r.count; dayErrorLookup[r.day] = r.errors; dayReadLookup[r.day] = r.rows_read; dayWriteLookup[r.day] = r.rows_written; }
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
      const reads = slots.map(s => {
        let total = 0;
        const d = new Date(s + "T00:00:00Z");
        for (let j = 0; j < 7; j++) {
          const dayStr = d.toISOString().slice(0, 10);
          total += dayReadLookup[dayStr] || 0;
          d.setUTCDate(d.getUTCDate() + 1);
        }
        return total;
      });
      const writes = slots.map(s => {
        let total = 0;
        const d = new Date(s + "T00:00:00Z");
        for (let j = 0; j < 7; j++) {
          const dayStr = d.toISOString().slice(0, 10);
          total += dayWriteLookup[dayStr] || 0;
          d.setUTCDate(d.getUTCDate() + 1);
        }
        return total;
      });
      const max = Math.max(...counts, 1);
      const maxRead = Math.max(...reads, 1);
      const maxWrite = Math.max(...writes, 1);
      return jsonResponse({ data: { slots, counts, errors, max, rows_read: reads, rows_written: writes, max_read: maxRead, max_written: maxWrite } });
    } else {
      slots = [];
      const endHour = now.getUTCHours() + 1;
      for (let i = 24; i >= 0; i--) {
        slots.push(String((endHour - i + 24) % 24).padStart(2, "0"));
      }
    }

    const counts = slots.map(s => lookup[s] || 0);
    const errors = slots.map(s => errorLookup[s] || 0);
    const reads = slots.map(s => rowsReadLookup[s] || 0);
    const writes = slots.map(s => rowsWrittenLookup[s] || 0);
    const max = Math.max(...counts, 1);
    const maxRead = Math.max(...reads, 1);
    const maxWrite = Math.max(...writes, 1);
    return jsonResponse({ data: { slots, counts, errors, max, rows_read: reads, rows_written: writes, max_read: maxRead, max_written: maxWrite } });
  });
}
