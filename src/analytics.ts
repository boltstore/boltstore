import { DatabasePool } from "./db/pool";
import { logger } from "./logger";

const ANALYTICS_DB = "_analytics.db";
const DEFAULT_RETENTION_DAYS = 30;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 100;

interface QueryEvent {
  database: string;
  databaseId?: string;
  table?: string;
  operation: string;
  durationMs: number;
  rowCount: number;
  status: string;
  errorMessage?: string;
  sqlText?: string;
}

export class AnalyticsManager {
  private pool: DatabasePool;
  private dataDir: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private retentionDays: number;
  private buffer: QueryEvent[] = [];

  constructor(dataDir: string, retentionDays = DEFAULT_RETENTION_DAYS) {
    this.dataDir = dataDir;
    this.retentionDays = retentionDays;
    this.pool = new DatabasePool({ path: `${dataDir}/${ANALYTICS_DB}`, readConnections: 1 });
    this.init();
    this.startFlushTimer();
    this.startPruneTimer();
  }

  private init(): void {
    const db = this.pool.write();
    db.run(`
      CREATE TABLE IF NOT EXISTS _query_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        database    TEXT NOT NULL,
        database_id TEXT,
        table_name  TEXT,
        operation   TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        row_count   INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'ok',
        error_msg   TEXT,
        timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _storage_snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        database    TEXT NOT NULL,
        database_id TEXT,
        size_bytes  INTEGER NOT NULL,
        table_count INTEGER NOT NULL,
        timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    try { db.run("ALTER TABLE _query_log ADD COLUMN sql_text TEXT"); } catch {}
    try { db.run("ALTER TABLE _query_log ADD COLUMN database_id TEXT"); } catch {}
    try { db.run("ALTER TABLE _storage_snapshots ADD COLUMN database_id TEXT"); } catch {}
    db.run(`
      CREATE TABLE IF NOT EXISTS _daily_stats (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        database    TEXT NOT NULL,
        database_id TEXT,
        date        TEXT NOT NULL,
        operation   TEXT NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        total_rows  INTEGER NOT NULL DEFAULT 0,
        total_ms    REAL NOT NULL DEFAULT 0,
        UNIQUE(database, date, operation)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _daily_queries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        database    TEXT NOT NULL,
        database_id TEXT,
        date        TEXT NOT NULL,
        sql_text    TEXT NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        writes      INTEGER NOT NULL DEFAULT 0,
        total_ms    REAL NOT NULL DEFAULT 0,
        total_rows  INTEGER NOT NULL DEFAULT 0,
        UNIQUE(database, date, sql_text)
      )
    `);
    try { db.run("ALTER TABLE _daily_stats ADD COLUMN database_id TEXT"); } catch {}
    try { db.run("ALTER TABLE _daily_queries ADD COLUMN database_id TEXT"); } catch {}
    db.run("CREATE INDEX IF NOT EXISTS idx_query_log_timestamp ON _query_log(timestamp)");
    db.run("CREATE INDEX IF NOT EXISTS idx_query_log_database ON _query_log(database)");
    db.run("CREATE INDEX IF NOT EXISTS idx_storage_snapshots_db_id ON _storage_snapshots(database, id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_daily_stats_db_date ON _daily_stats(database, date)");
    db.run("CREATE INDEX IF NOT EXISTS idx_daily_queries_db_date ON _daily_queries(database, date)");
  }

  // In-memory buffer — up to 100 events (FLUSH_BATCH_SIZE) or 5 seconds
  // (FLUSH_INTERVAL_MS) of analytics data is lost on process crash.
  recordQuery(event: QueryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      this.flush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      const db = this.pool.write();
      const stmt = db.prepare(
        "INSERT INTO _query_log (database, database_id, table_name, operation, duration_ms, row_count, status, error_msg, sql_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const statsStmt = db.prepare(
        `INSERT INTO _daily_stats (database, database_id, date, operation, count, error_count, total_rows, total_ms)
         VALUES (?, ?, date('now'), ?, 1, ?, ?, ?)
         ON CONFLICT(database, date, operation) DO UPDATE SET
           count = count + 1,
           error_count = error_count + excluded.error_count,
           total_rows = total_rows + excluded.total_rows,
           total_ms = total_ms + excluded.total_ms`
      );
      const queriesStmt = db.prepare(
        `INSERT INTO _daily_queries (database, database_id, date, sql_text, count, writes, total_ms, total_rows)
         VALUES (?, ?, date('now'), ?, 1, ?, ?, ?)
         ON CONFLICT(database, date, sql_text) DO UPDATE SET
           count = count + 1,
           writes = writes + excluded.writes,
           total_ms = total_ms + excluded.total_ms,
           total_rows = total_rows + excluded.total_rows`
      );
      for (const e of batch) {
        stmt.run(e.database, e.databaseId ?? null, e.table ?? null, e.operation, e.durationMs, e.rowCount, e.status, e.errorMessage ?? null, e.sqlText ?? null);
        const isError = e.status === "error" ? 1 : 0;
        statsStmt.run(e.database, e.databaseId ?? null, e.operation, isError, e.rowCount, e.durationMs);
        const sql = e.sqlText ?? e.operation;
        const isWriteOp = e.operation !== "select" ? 1 : 0;
        queriesStmt.run(e.database, e.databaseId ?? null, sql, isWriteOp, e.durationMs, e.rowCount);
      }
    } catch (err) {
      logger.warn("Analytics flush failed, re-queueing events", { error: err instanceof Error ? err.message : String(err) });
      this.buffer.unshift(...batch);
    }
  }

  private prune(): void {
    try {
      const cutoff = `-${this.retentionDays} days`;
      this.pool.write().run("DELETE FROM _query_log WHERE timestamp < datetime('now', ?)", [cutoff]);
      this.pool.write().run("DELETE FROM _daily_stats WHERE date < date('now', ?)", [cutoff]);
      this.pool.write().run("DELETE FROM _daily_queries WHERE date < date('now', ?)", [cutoff]);
    } catch (err) {
      logger.warn("Analytics prune failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private startPruneTimer(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => this.prune(), 3600_000);
    if (typeof this.pruneTimer.unref === "function") this.pruneTimer.unref();
  }

  startSnapshotTimer(getDatabases: () => string[], getPool: (name: string) => DatabasePool | null, resolveDbId?: (name: string) => string | undefined): void {
    if (this.timer) return;
    const takeSnapshot = async () => {
      try {
        const names = getDatabases();
        for (const name of names) {
          try {
            // Reuse the existing pool from the manager if available;
            // only open a temporary pool as a fallback.
            let pool = getPool(name);
            let openedTemp = false;
            if (!pool) {
              const path = `${this.dataDir}/${name}.db`;
              const file = Bun.file(path);
              if (!(await file.exists())) continue;
              pool = new DatabasePool({ path, readConnections: 1 });
              openedTemp = true;
            }
            const db = pool.read();
            const pageInfo = db.query("PRAGMA page_count").get() as { page_count: number } | null;
            const pageSize = db.query("PRAGMA page_size").get() as { page_size: number } | null;
            const tableCount = (db.query("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*' AND name != 'sqlite_sequence'").get() as { c?: number })?.c ?? 0;
            if (openedTemp) pool.close();
            const sizeBytes = (pageInfo?.page_count ?? 0) * (pageSize?.page_size ?? 4096);
            const dbId = resolveDbId?.(name);
            this.pool.write().run(
              "INSERT INTO _storage_snapshots (database, database_id, size_bytes, table_count) VALUES (?, ?, ?, ?)",
              [name, dbId ?? null, sizeBytes, tableCount]
            );
          } catch (err) {
            logger.warn("Snapshot failed for database", { database: name, error: err instanceof Error ? err.message : String(err) });
          }
        }
      } catch (err) {
        logger.warn("Snapshot timer failed", { error: err instanceof Error ? err.message : String(err) });
      }
    };
    takeSnapshot();
    this.timer = setInterval(takeSnapshot, SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    this.flush();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pool.close();
  }

  async ensureSnapshot(name: string, getPool: (name: string) => DatabasePool | null, resolveDbId?: (name: string) => string | undefined): Promise<void> {
    const db = this.pool.read();
    const existing = db.query("SELECT 1 FROM _storage_snapshots WHERE database = ? LIMIT 1").get(name);
    if (existing) return;

    let pool = getPool(name);
    let openedTemp = false;
    if (!pool) {
      const path = `${this.dataDir}/${name}.db`;
      const file = Bun.file(path);
      if (!(await file.exists())) return;
      pool = new DatabasePool({ path, readConnections: 1 });
      openedTemp = true;
    }
    try {
      const conn = pool.read();
      const pageInfo = conn.query("PRAGMA page_count").get() as { page_count: number } | null;
      const pageSize = conn.query("PRAGMA page_size").get() as { page_size: number } | null;
      const tableCount = (conn.query("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*' AND name != 'sqlite_sequence'").get() as { c?: number })?.c ?? 0;
      const sizeBytes = (pageInfo?.page_count ?? 0) * (pageSize?.page_size ?? 4096);
      const dbId = resolveDbId?.(name);
      this.pool.write().run(
        "INSERT INTO _storage_snapshots (database, database_id, size_bytes, table_count) VALUES (?, ?, ?, ?)",
        [name, dbId ?? null, sizeBytes, tableCount]
      );
    } catch (err) {
      logger.warn("On-demand snapshot failed", { database: name, error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (openedTemp) pool.close();
    }
  }

  getPool(): DatabasePool {
    return this.pool;
  }
}
