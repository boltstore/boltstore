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

function formatTzKey(date: Date, hourly: boolean): string {
  const yh = date.getUTCFullYear();
  const mh = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dh = String(date.getUTCDate()).padStart(2, '0');
  if (hourly) {
    return `${yh}-${mh}-${dh} ${String(date.getUTCHours()).padStart(2, '0')}:00:00`;
  }
  return `${yh}-${mh}-${dh}`;
}

export function registerAnalyticsRoutes(router: Router, manager: DatabaseManager, analytics: AnalyticsManager): void {
  const pool = analytics.getPool();

  const getPool = (name: string) => {
    try { return manager.getPoolIfExists(name); } catch { return null; }
  };
  const ensureAllSnapshots = async (db: ReturnType<typeof pool.read>) => {
    const dbNames = manager.listDatabases().map(d => d.name);
    for (const name of dbNames) {
      const exists = db.query("SELECT 1 FROM _storage_snapshots WHERE database = ? LIMIT 1").get(name);
      if (!exists) await analytics.ensureSnapshot(name, getPool);
    }
  };

  router.get("/api/analytics/overview", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const { since } = parseRange(url);
    const db = pool.read();

    const queries = (db.query(
      `SELECT COUNT(*) as c, COALESCE(AVG(duration_ms), 0) as avg_ms, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN 1 ELSE 0 END), 0) as writes, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as rows_read, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as rows_written FROM _query_log WHERE timestamp >= datetime('now', ?)`
    ).get(since) as QueryStatsRow & { rows_read: number; rows_written: number }) ?? { c: 0, avg_ms: 0, errors: 0, writes: 0, rows_read: 0, rows_written: 0 };

    await ensureAllSnapshots(db);
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

    let storage = db.query(
      "SELECT size_bytes, table_count FROM _storage_snapshots WHERE database = ? ORDER BY timestamp DESC LIMIT 1"
    ).get(params.database) as StorageRow | undefined;
    if (!storage) {
      await analytics.ensureSnapshot(params.database, getPool);
      storage = (db.query(
        "SELECT size_bytes, table_count FROM _storage_snapshots WHERE database = ? ORDER BY timestamp DESC LIMIT 1"
      ).get(params.database) as StorageRow) ?? { size_bytes: 0, table_count: 0 };
    }

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

    await ensureAllSnapshots(db);
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
    const db = pool.read();

    const metaRow = manager.getMetaPool().read().query("SELECT value FROM _meta WHERE key = 'global_settings'").get() as { value: string } | null;
    const settings = metaRow ? { timezone: "UTC", ...JSON.parse(metaRow.value) } : { timezone: "UTC" };
    const tz = url.searchParams.get("tz") || settings.timezone;
    const tzAdj = getTzSign(tz);
    const tzTimestamp = tzAdj ? `datetime(timestamp, '${tzAdj}')` : "timestamp";

    const now = getTzDate(tz);

    interface Slot { label: string; start: Date; end: Date }
    const slots: Slot[] = [];

    if (range === "24h") {
      const rightmost = new Date(now);
      rightmost.setUTCMinutes(0, 0, 0);
      if (now.getUTCMinutes() > 0 || now.getUTCSeconds() > 0 || now.getUTCMilliseconds() > 0) {
        rightmost.setUTCHours(rightmost.getUTCHours() + 1);
      }
      for (let i = 23; i >= 0; i--) {
        const end = new Date(rightmost);
        end.setUTCHours(end.getUTCHours() - i);
        const start = new Date(end);
        start.setUTCHours(start.getUTCHours() - 1);
        slots.push({ label: `${String(end.getUTCHours()).padStart(2, '0')}:00`, start, end });
      }
    } else if (range === "7d") {
      const rightmost = new Date(now);
      rightmost.setUTCMinutes(0, 0, 0);
      const hoursSinceMidnight = rightmost.getUTCHours();
      if (hoursSinceMidnight > 0) {
        rightmost.setTime(rightmost.getTime() + (24 - hoursSinceMidnight) * 3600000);
      }
      for (let i = 6; i >= 0; i--) {
        const end = new Date(rightmost);
        end.setUTCDate(end.getUTCDate() - i);
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - 1);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        slots.push({ label: `${months[end.getUTCMonth()]} ${end.getUTCDate()}`, start, end });
      }
    } else {
      const rightmost = new Date(now);
      rightmost.setUTCMinutes(0, 0, 0);
      const hoursSinceMidnight = rightmost.getUTCHours();
      if (hoursSinceMidnight > 0) {
        rightmost.setTime(rightmost.getTime() + (24 - hoursSinceMidnight) * 3600000);
      }
      const daysUntilNextSunday = (7 - rightmost.getUTCDay()) % 7;
      if (daysUntilNextSunday > 0) {
        rightmost.setTime(rightmost.getTime() + daysUntilNextSunday * 86400000);
      } else {
        rightmost.setTime(rightmost.getTime() + 7 * 86400000);
      }
      for (let i = 4; i >= 0; i--) {
        const end = new Date(rightmost);
        end.setUTCDate(end.getUTCDate() - i * 7);
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - 7);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        slots.push({ label: `${months[start.getUTCMonth()]} ${start.getUTCDate()}`, start, end });
      }
    }

    const tzOffsetMs = now.getTime() - Date.now();
    const windowStart = new Date(slots[0].start.getTime() - tzOffsetMs).toISOString().replace("T", " ").replace("Z", "");
    const windowEnd = new Date(slots[slots.length - 1].end.getTime() - tzOffsetMs).toISOString().replace("T", " ").replace("Z", "");

    let groupKey: string;
    if (range === "24h") {
      groupKey = `strftime('%Y-%m-%d %H:00:00', ${tzTimestamp})`;
    } else {
      groupKey = `strftime('%Y-%m-%d', ${tzTimestamp})`;
    }

    const rows = db.query(
      `SELECT ${groupKey} as k, COUNT(*) as c, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as e, COALESCE(SUM(CASE WHEN operation = 'select' THEN row_count ELSE 0 END), 0) as r, COALESCE(SUM(CASE WHEN operation IN ('insert','update','delete') THEN row_count ELSE 0 END), 0) as w FROM _query_log WHERE timestamp >= ? AND timestamp < ? GROUP BY k ORDER BY k`
    ).all(windowStart, windowEnd) as { k: string; c: number; e: number; r: number; w: number }[];

    const rowMap = new Map<string, typeof rows[0]>();
    for (const row of rows) rowMap.set(row.k, row);

    const counts: number[] = [];
    const errors: number[] = [];
    const reads: number[] = [];
    const writes: number[] = [];
    const slotLabels: string[] = [];

    for (const slot of slots) {
      if (range === "24h") {
        const key = formatTzKey(slot.start, true);
        const row = rowMap.get(key);
        counts.push(row?.c ?? 0);
        errors.push(row?.e ?? 0);
        reads.push(row?.r ?? 0);
        writes.push(row?.w ?? 0);
      } else {
        let c = 0, e = 0, r = 0, w = 0;
        const cursor = new Date(slot.start);
        while (cursor < slot.end) {
          const key = formatTzKey(cursor, false);
          const row = rowMap.get(key);
          if (row) { c += row.c; e += row.e; r += row.r; w += row.w; }
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        counts.push(c);
        errors.push(e);
        reads.push(r);
        writes.push(w);
      }
      slotLabels.push(slot.label);
    }

    const max = Math.max(...counts, 1);
    const maxRead = Math.max(...reads, 1);
    const maxWrite = Math.max(...writes, 1);
    return jsonResponse({ data: { slots: slotLabels, counts, errors, max, rows_read: reads, rows_written: writes, max_read: maxRead, max_written: maxWrite } });
  });
}
