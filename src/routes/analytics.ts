import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { AnalyticsManager } from "../analytics";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { validateDbName } from "../validation";

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
    case "30d": return { since: "-30 days", groupFmt: "'%Y-%m-%d'" };
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
    const dbNameErr = validateDbName(params.database);
    if (dbNameErr) return dbNameErr;
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

  router.get("/api/analytics/databases", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();

    const queryStats = db.query(
      `SELECT database, COUNT(*) as c, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as rows_read, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as rows_written FROM _query_log WHERE timestamp >= datetime('now', ?) GROUP BY database`
    ).all(since) as { database: string; c: number; avg_ms: number; errors: number; writes: number; rows_read: number; rows_written: number }[];

    const storageRows = db.query(
      "SELECT database, size_bytes, table_count FROM _storage_snapshots WHERE id IN (SELECT MAX(id) FROM _storage_snapshots GROUP BY database)"
    ).all() as { database: string; size_bytes: number; table_count: number }[];
    const storageMap: Record<string, { size_bytes: number; table_count: number }> = {};
    for (const s of storageRows) storageMap[s.database] = s;

    const dbNames = manager.listDatabases().map(d => d.name);
    const data = dbNames.map(name => {
      const q = queryStats.find(s => s.database === name);
      const s = storageMap[name];
      return {
        database: name,
        queries: q?.c ?? 0,
        writes: q?.writes ?? 0,
        avgLatencyMs: Math.round((q?.avg_ms ?? 0) * 10) / 10,
        errorCount: q?.errors ?? 0,
        rows_read: q?.rows_read ?? 0,
        rows_written: q?.rows_written ?? 0,
        storageBytes: s?.size_bytes ?? 0,
        tableCount: s?.table_count ?? 0,
      };
    });

    return jsonResponse({ data });
  });

  router.get("/api/analytics/:database/queries", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const dbNameErr = validateDbName(params.database);
    if (dbNameErr) return dbNameErr;
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
    const dbNameErr = validateDbName(params.database);
    if (dbNameErr) return dbNameErr;
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
    const sinceExpr = tzAdj ? `datetime('now', '${tzAdj}', '${since}')` : `datetime('now', '${since}')`;
    const tzTimestamp = tzAdj ? `datetime(timestamp, '${tzAdj}')` : "timestamp";

    if (range === "24h") {
      const hourSlots = Array.from({ length: 24 }, (_, i) => `(printf('%02d', ${i}))`).join(", ");
      const query = db.query(
        `WITH slots(s) AS (VALUES ${hourSlots})
         SELECT slots.s as slot, COALESCE(q.c, 0) as count, COALESCE(q.e, 0) as errors, COALESCE(q.r, 0) as rows_read, COALESCE(q.w, 0) as rows_written
         FROM slots LEFT JOIN (
           SELECT strftime('%H', ${tzTimestamp}) as s, COUNT(*) as c, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as e, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as r, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as w FROM _query_log WHERE ${tzTimestamp} >= ${sinceExpr} GROUP BY s
         ) q ON q.s = slots.s ORDER BY slots.s`
      ).all() as { slot: string; count: number; errors: number; rows_read: number; rows_written: number }[];
      const slots = query.map(r => r.slot);
      const counts = query.map(r => r.count);
      const errors = query.map(r => r.errors);
      const reads = query.map(r => r.rows_read);
      const writes = query.map(r => r.rows_written);
      const max = Math.max(...counts, 1);
      const maxRead = Math.max(...reads, 1);
      const maxWrite = Math.max(...writes, 1);
      return jsonResponse({ data: { slots, counts, errors, max, rows_read: reads, rows_written: writes, max_read: maxRead, max_written: maxWrite } });
    }

    const query = db.query(
      `WITH RECURSIVE slots(s) AS (SELECT date(${sinceExpr}) UNION ALL SELECT date(s, '+1 day') FROM slots WHERE s < date('now'))
       SELECT strftime(${groupFmt}, slots.s) as slot, COALESCE(q.c, 0) as count, COALESCE(q.e, 0) as errors, COALESCE(q.r, 0) as rows_read, COALESCE(q.w, 0) as rows_written
       FROM slots LEFT JOIN (
         SELECT strftime(${groupFmt}, ${tzTimestamp}) as s, COUNT(*) as c, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as e, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as r, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as w FROM _query_log WHERE ${tzTimestamp} >= ${sinceExpr} GROUP BY s
       ) q ON q.s = strftime(${groupFmt}, slots.s) ORDER BY slots.s`
    ).all() as { slot: string; count: number; errors: number; rows_read: number; rows_written: number }[];

    const slots = query.map(r => r.slot);
    const counts = query.map(r => r.count);
    const errors = query.map(r => r.errors);
    const reads = query.map(r => r.rows_read);
    const writes = query.map(r => r.rows_written);
    const max = Math.max(...counts, 1);
    const maxRead = Math.max(...reads, 1);
    const maxWrite = Math.max(...writes, 1);
    return jsonResponse({ data: { slots, counts, errors, max, rows_read: reads, rows_written: writes, max_read: maxRead, max_written: maxWrite } });
  });
}
