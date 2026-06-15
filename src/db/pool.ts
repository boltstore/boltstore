/**
 * SQLite database pool with read/write connection separation.
 *
 * WAL mode allows unlimited concurrent readers. All writes serialize
 * through a single connection to eliminate SQLITE_BUSY entirely.
 *
 * @module boltstore/db/pool
 */

import { Database } from "bun:sqlite";

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
}

const DEFAULT_CONFIG: PoolConfig = {
  path: Bun.env.DATABASE_PATH || "./data/boltstore.db",
  readConnections: 4,
  wal: true,
  synchronousNormal: true,
  busyTimeout: 5000,
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

  constructor(config?: PoolConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const dbPath = this.config.path!;

    // Ensure directory exists
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dir) {
      // Use Bun's mkdir
      Bun.spawnSync(["mkdir", "-p", dir]);
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
   * Execute a function within a transaction on the write connection.
   * All operations are serialized through this single connection.
   *
   * Uses explicit BEGIN/COMMIT with WAL checkpoint after commit so
   * read connections see changes immediately.
   */
  writeTransaction<T>(fn: () => T): T {
    const db = this.writeDb;
    db.run("BEGIN");
    try {
      const result = fn();
      db.run("COMMIT");
      // Checkpoint WAL so read connections see the changes
      try { db.run("PRAGMA wal_checkpoint(PASSIVE)"); } catch {}
      return result;
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
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