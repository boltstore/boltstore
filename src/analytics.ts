import { DatabasePool } from "./db/pool";

const ANALYTICS_DB = "_analytics.db";
const DEFAULT_RETENTION_DAYS = 30;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 100;

interface QueryEvent {
  database: string;
  table?: string;
  operation: string;
  durationMs: number;
  rowCount: number;
  status: string;
  errorMessage?: string;
}

export class AnalyticsManager {
  private pool: DatabasePool;
  private dataDir: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retentionDays: number;
  private buffer: QueryEvent[] = [];

  constructor(dataDir: string, retentionDays = DEFAULT_RETENTION_DAYS) {
    this.dataDir = dataDir;
    this.retentionDays = retentionDays;
    this.pool = new DatabasePool({ path: `${dataDir}/${ANALYTICS_DB}`, readConnections: 1 });
    this.init();
    this.startFlushTimer();
  }

  private init(): void {
    const db = this.pool.write();
    db.run(`
      CREATE TABLE IF NOT EXISTS _query_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        database    TEXT NOT NULL,
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
        size_bytes  INTEGER NOT NULL,
        table_count INTEGER NOT NULL,
        timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

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
        "INSERT INTO _query_log (database, table_name, operation, duration_ms, row_count, status, error_msg) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (const e of batch) {
        stmt.run(e.database, e.table ?? null, e.operation, e.durationMs, e.rowCount, e.status, e.errorMessage ?? null);
      }
      this.prune();
    } catch {}
  }

  private prune(): void {
    try {
      this.pool.write().run(
        "DELETE FROM _query_log WHERE timestamp < datetime('now', ?)",
        [`-${this.retentionDays} days`]
      );
    } catch {}
  }

  startSnapshotTimer(getDatabases: () => string[]): void {
    if (this.timer) return;
    const takeSnapshot = async () => {
      try {
        const names = getDatabases();
        for (const name of names) {
          try {
            const path = `${this.dataDir}/${name}.db`;
            const file = Bun.file(path);
            const exists = await file.exists();
            if (!exists) continue;
            const pool = new DatabasePool({ path, readConnections: 1 });
            const db = pool.read();
            const pageInfo = db.query("PRAGMA page_count").get() as { page_count: number } | null;
            const pageSize = db.query("PRAGMA page_size").get() as { page_size: number } | null;
            const tableCount = (db.query("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*' AND name != 'sqlite_sequence'").get() as any)?.c ?? 0;
            pool.close();
            const sizeBytes = (pageInfo?.page_count ?? 0) * (pageSize?.page_size ?? 4096);
            this.pool.write().run(
              "INSERT INTO _storage_snapshots (database, size_bytes, table_count) VALUES (?, ?, ?)",
              [name, sizeBytes, tableCount]
            );
          } catch {}
        }
      } catch {}
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
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pool.close();
  }

  getPool(): DatabasePool {
    return this.pool;
  }
}
