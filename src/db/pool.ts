/**
 * SQLite database pool with read/write connection separation.
 *
 * WAL mode allows unlimited concurrent readers. All writes serialize
 * through a single connection to eliminate SQLITE_BUSY entirely.
 *
 * @module boltstore/db/pool
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { logger } from "../logger";
import { toBindings } from "../db/cast";

export interface PoolConfig {
  /** Path to the SQLite database file. Defaults to DATABASE_PATH env var or "./data/boltstore.db". */
  path?: string;
  /** Number of read connections to create in the pool. Default: 4. */
  readConnections?: number;
  /** Enable WAL mode. Default: true. */
  wal?: boolean;
  /** Set PRAGMA synchronous = NORMAL. Default: true. */
  synchronousNormal?: boolean;
  /** Busy timeout in milliseconds. Default: 5000. */
  busyTimeout?: number;
  /** Maximum query execution time in milliseconds. 0 disables. Default: 0. */
  queryTimeoutMs?: number;
}

const DEFAULT_CONFIG: PoolConfig = {
  path: Bun.env.DATABASE_PATH || "./data/boltstore.db",
  readConnections: 4,
  wal: true,
  synchronousNormal: true,
  busyTimeout: 5000,
  queryTimeoutMs: parseInt(Bun.env.QUERY_TIMEOUT_MS || "0", 10) || 0,
};

/**
 * Database pool that provides separate connections for reads and writes.
 *
 * - **Read Pool:** Multiple connections for concurrent reads (WAL mode supports this).
 * - **Write Pool:** Single connection. All mutations serialize through one Database
 *   instance, batched in db.transaction() (via `writeTransaction`).
 *
 * This eliminates SQLITE_BUSY entirely — no write contention, no retry logic needed.
 */
export class DatabasePool {
  private readPool: Database[] = [];
  private writeDb: Database;
  private readIndex = 0;
  private config: PoolConfig;
  private transactionDepth = 0;

  constructor(config?: PoolConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const dbPath = this.config.path!;

    // Ensure directory exists
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dir) {
      mkdirSync(dir, { recursive: true });
    }

    // Create write connection first
    this.writeDb = new Database(dbPath);
    this.applyPragmas(this.writeDb);

    // Create read connections
    const readCount = this.config.readConnections || 1;
    for (let i = 0; i < readCount; i++) {
      const readDb = new Database(dbPath);
      this.applyPragmas(readDb, true);
      this.readPool.push(readDb);
    }
  }

  private queryTimer(db: Database, isReadOnly = false): (() => void) | null {
    const timeout = this.config.queryTimeoutMs;
    if (!timeout || timeout <= 0) return null;
    let finished = false;
    const t = setTimeout(() => {
      if (finished) return;
      logger.warn("Query timeout exceeded (advisory only — query continues)", {
        path: this.config.path,
        type: isReadOnly ? "read" : "write",
        timeout_ms: timeout,
      });
    }, timeout);
    return () => {
      finished = true;
      clearTimeout(t);
    };
  }

  /**
   * Log a slow query if execution time exceeds the configured threshold.
   * Threshold defaults to queryTimeoutMs if set, otherwise 1000ms.
   */
  private logSlowQuery(
    sql: string,
    params: unknown[],
    durationMs: number,
    isReadOnly = false
  ): void {
    const threshold = this.config.queryTimeoutMs || 1000;
    if (durationMs < threshold) return;
    logger.warn("Slow query detected", {
      path: this.config.path,
      type: isReadOnly ? "read" : "write",
      duration_ms: Math.round(durationMs),
      sql: sql.slice(0, 500),
      params: params.length > 0 ? params.slice(0, 20) : undefined,
    });
  }

  /**
   * Apply SQLite PRAGMAs to a database connection.
   */
  private applyPragmas(db: Database, isReadOnly = false): void {
    if (this.config.wal) {
      db.run("PRAGMA journal_mode = WAL");
    }
    if (this.config.synchronousNormal) {
      db.run("PRAGMA synchronous = NORMAL");
    }
    if (this.config.busyTimeout) {
      db.run(`PRAGMA busy_timeout = ${this.config.busyTimeout}`);
    }
    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");
  }

  /**
   * Get a read connection from the pool (round-robin).
   * Use this for SELECT queries.
   */
  read(): Database {
    const db = this.readPool[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.readPool.length;
    return db;
  }

  /**
   * Get the write connection (single, serialized).
   * Use this for INSERT, UPDATE, DELETE, and schema changes.
   */
  write(): Database {
    return this.writeDb;
  }

  /**
   * Execute a read query with optional timeout and slow-query logging.
   */
  readQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): T[] {
    const db = this.read();
    const start = performance.now();
    const cleanup = this.queryTimer(db, true);
    try {
      return db.query(sql).all(...toBindings(params)) as T[];
    } finally {
      const duration = performance.now() - start;
      cleanup?.();
      this.logSlowQuery(sql, params, duration, true);
    }
  }

  /**
   * Execute a write query with optional timeout and slow-query logging.
   */
  writeQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): { rows: T[]; changes: number; lastInsertRowid: number | bigint } {
    const db = this.write();
    const start = performance.now();
    const cleanup = this.queryTimer(db, false);
    try {
      const rows = db.query(sql).all(...toBindings(params)) as T[];
      const changes = db.query("SELECT changes() as cnt").get() as { cnt: number };
      const lastId = db.query("SELECT last_insert_rowid() as id").get() as { id: number | bigint };
      return {
        rows,
        changes: changes.cnt,
        lastInsertRowid: lastId.id,
      };
    } finally {
      const duration = performance.now() - start;
      cleanup?.();
      this.logSlowQuery(sql, params, duration, false);
    }
  }

  /**
   * Execute a write statement with optional timeout and slow-query logging.
   */
  writeRun(sql: string, params: unknown[] = []): ReturnType<Database["run"]> {
    const db = this.write();
    const start = performance.now();
    const cleanup = this.queryTimer(db, false);
    try {
      return db.run(sql, toBindings(params));
    } finally {
      const duration = performance.now() - start;
      cleanup?.();
      this.logSlowQuery(sql, params, duration, false);
    }
  }

  /**
   * Execute a function within a transaction on the write connection.
   * All operations are serialized through this single connection.
   *
   * WAL mode allows concurrent reads inside a write transaction —
   * SELECTs work normally without blocking. Read queries inside
   * writeTransaction are safe but prefer `read()` for read-only work.
   *
   * Uses explicit BEGIN/COMMIT. WAL checkpointing is deferred — SQLite's
   * WAL mode handles checkpointing automatically. Explicit checkpoints
   * on every commit added ~5-15ms latency per write transaction.
   * Call `checkpointWal()` explicitly when immediate read-after-write
   * consistency is required (e.g., tests, backup metadata).
   */
  writeTransaction<T>(fn: () => T): T {
    const db = this.writeDb;
    // Single-level only — no nested transaction support.
    // All writes serialize through this single connection, so there is no
    // concurrent-write hazard; nested calls reuse the open transaction.
    if (this.transactionDepth > 0) {
      // Already inside a transaction — just run fn
      return fn();
    }
    db.run("BEGIN");
    this.transactionDepth++;
    try {
      const result = fn();
      db.run("COMMIT");
      this.transactionDepth--;
      return result;
    } catch (error) {
      this.transactionDepth--;
      try { db.run("ROLLBACK"); } catch {}
      throw error;
    }
  }

  /**
   * Force a WAL checkpoint. Call this after writeTransaction when
   * immediate read-after-write consistency across connections is needed.
   */
  checkpointWal(): void {
    try { this.writeDb.run("PRAGMA wal_checkpoint(PASSIVE)"); } catch (err) {
      logger.warn("WAL checkpoint failed", { path: this.config.path, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Close all database connections.
   */
  close(): void {
    this.writeDb.close();
    for (const db of this.readPool) {
      db.close();
    }
    this.readPool = [];
  }

  /**
   * Get pool statistics.
   */
  stats(): PoolStats {
    return {
      readConnections: this.readPool.length,
      writeConnection: true,
      path: this.config.path || "",
    };
  }
}

export interface PoolStats {
  readConnections: number;
  writeConnection: boolean;
  path: string;
}

export default DatabasePool;