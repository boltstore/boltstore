import { DatabasePool } from "./pool";
import type { AnalyticsManager } from "../analytics";
import { mkdirSync, rmSync } from "node:fs";
import { logger } from "../logger";

export const SCHEMA_VERSION = 2;

export interface DatabaseInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
  group?: string;
  readonly?: boolean;
}

export interface ManagerConfig {
  dataDir?: string;
}

const DEFAULT_CONFIG: ManagerConfig = {
  dataDir: Bun.env.DATABASE_PATH || "./data",
};

export class DatabaseManager {
  private config: ManagerConfig;
  private metaPool: DatabasePool;
  private appPools: Map<string, { pool: DatabasePool; lastUsed: number }> = new Map();
  private analytics: AnalyticsManager | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly idleTimeoutMs = 10 * 60 * 1000; // 10 minutes

  setAnalytics(a: AnalyticsManager): void {
    this.analytics = a;
  }

  getAnalytics(): AnalyticsManager | null {
    return this.analytics;
  }

  constructor(config?: ManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    mkdirSync(this.config.dataDir!, { recursive: true });
    mkdirSync(`${this.config.dataDir}/plugins`, { recursive: true });

    const metaPath = `${this.config.dataDir}/_boltstore.db`;
    this.metaPool = new DatabasePool({ path: metaPath, readConnections: 1 });

    const db = this.metaPool.write();
    db.run(`
      CREATE TABLE IF NOT EXISTS _databases (
        name TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        config TEXT NOT NULL DEFAULT '{}'
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _api_keys (
        id TEXT PRIMARY KEY,
        database_name TEXT NOT NULL REFERENCES _databases(name) ON DELETE CASCADE,
        label TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _admins (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _activity_log (
        id TEXT PRIMARY KEY,
        admin_id TEXT REFERENCES _admins(id),
        action TEXT NOT NULL,
        database_name TEXT,
        target TEXT,
        details TEXT,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _sessions (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL REFERENCES _admins(id),
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `);
    // Migrate old schema: if token column exists, rename to token_hash and add expires_at
    try {
      const cols = db.query("PRAGMA table_info(_sessions)").all() as { name: string }[];
      const hasToken = cols.some(c => c.name === "token");
      const hasTokenHash = cols.some(c => c.name === "token_hash");
      const hasExpiresAt = cols.some(c => c.name === "expires_at");
      if (hasToken && !hasTokenHash) {
        db.run("ALTER TABLE _sessions RENAME COLUMN token TO token_hash");
      }
      if (!hasExpiresAt) {
        db.run("ALTER TABLE _sessions ADD COLUMN expires_at TEXT");
      }
    } catch {
      // Fresh table or migration not needed
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    // Ensure schema version is recorded
    const existingVersion = db.query("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string } | null;
    if (!existingVersion) {
      db.run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
    } else if (parseInt(existingVersion.value, 10) > SCHEMA_VERSION) {
      throw new Error(`System database schema version ${existingVersion.value} is newer than server version ${SCHEMA_VERSION}. Upgrade the server to use this database.`);
    }
  }

  getSchemaVersion(): number {
    try {
      const row = this.metaPool.read().query("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string } | null;
      return row ? parseInt(row.value, 10) : 0;
    } catch { return 0; }
  }

  get(name: string): DatabasePool {
    const cached = this.appPools.get(name);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.pool;
    }

    return this.metaPool.writeTransaction(() => {
      const existing = this.appPools.get(name);
      if (existing) {
        existing.lastUsed = Date.now();
        return existing.pool;
      }

      const metaDb = this.metaPool.read();
      const row = metaDb.query("SELECT file_path FROM _databases WHERE name=?").get(name) as { file_path: string } | null;
      if (!row) {
        throw Object.assign(new Error(`Database "${name}" not found.`), { status: 404 });
      }

      const pool = new DatabasePool({ path: row.file_path });
      this.appPools.set(name, { pool, lastUsed: Date.now() });
      this.startEvictionTimer();
      return pool;
    });
  }

  createDatabase(name: string, group?: string): DatabaseInfo {
    const path = `${this.config.dataDir}/${name}.db`;
    const now = new Date().toISOString();
    const config = group ? JSON.stringify({ group }) : "{}";

    // Use a transaction to atomically check + insert, catching the PRIMARY KEY
    // constraint violation if two concurrent requests race to create the same DB.
    try {
      this.metaPool.writeTransaction(() => {
        const metaDb = this.metaPool.write();
        metaDb.run("INSERT OR ABORT INTO _databases (name, file_path, created_at, config) VALUES (?, ?, ?, ?)", [name, path, now, config]);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY")) {
        throw Object.assign(new Error(`Database "${name}" already exists.`), { status: 409 });
      }
      throw err;
    }

    const pool = new DatabasePool({ path });
    this.appPools.set(name, { pool, lastUsed: Date.now() });
    this.startEvictionTimer();

    return { id: name, name, path, createdAt: now, group };
  }

  registerDatabase(name: string, filePath: string, group?: string): DatabasePool {
    const now = new Date().toISOString();
    const config = group ? JSON.stringify({ group }) : "{}";
    try {
      this.metaPool.writeTransaction(() => {
        this.metaPool.write().run("INSERT OR ABORT INTO _databases (name, file_path, created_at, config) VALUES (?, ?, ?, ?)", [name, filePath, now, config]);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY") || msg.includes("ABORT")) {
        throw Object.assign(new Error(`Database "${name}" already exists.`), { status: 409 });
      }
      throw err;
    }
    const pool = new DatabasePool({ path: filePath });
    this.appPools.set(name, { pool, lastUsed: Date.now() });
    this.startEvictionTimer();
    return pool;
  }

  deleteDatabase(name: string): void {
    const metaDb = this.metaPool.write();
    const row = metaDb.query("SELECT file_path FROM _databases WHERE name=?").get(name) as { file_path: string } | null;
    if (!row) {
      throw Object.assign(new Error(`Database "${name}" not found.`), { status: 404 });
    }

    const cached = this.appPools.get(name);
    if (cached) {
      cached.pool.close();
      this.appPools.delete(name);
    }

    metaDb.run("DELETE FROM _databases WHERE name=?", [name]);

    try {
      rmSync(row.file_path, { force: true });
      rmSync(row.file_path + "-wal", { force: true });
      rmSync(row.file_path + "-shm", { force: true });
    } catch (err) {
      logger.warn("Failed to clean up database files after delete", { database: name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  listDatabases(): DatabaseInfo[] {
    const metaDb = this.metaPool.read();
    const rows = metaDb.query("SELECT name, file_path, created_at, config FROM _databases ORDER BY name").all() as {
      name: string;
      file_path: string;
      created_at: string;
      config: string;
    }[];
    return rows.map((r) => {
      let group: string | undefined;
      let readonly = false;
      try {
        const cfg = JSON.parse(r.config);
        group = cfg.group;
        readonly = !!cfg.readonly;
      } catch (err) {
        logger.warn("Failed to parse database config JSON", { database: r.name, error: err instanceof Error ? err.message : String(err) });
      }
      return { id: r.name, name: r.name, path: r.file_path, createdAt: r.created_at, group, readonly };
    });
  }

  exists(name: string): boolean {
    const metaDb = this.metaPool.read();
    const row = metaDb.query("SELECT 1 FROM _databases WHERE name=?").get(name);
    return row !== null;
  }

  getDataDir(): string {
    return this.config.dataDir!;
  }

  getMetaPool(): DatabasePool {
    return this.metaPool;
  }

  getPoolIfExists(name: string): DatabasePool | null {
    const entry = this.appPools.get(name);
    return entry ? entry.pool : null;
  }

  closePool(name: string): void {
    const cached = this.appPools.get(name);
    if (cached) {
      cached.pool.close();
      this.appPools.delete(name);
    }
  }

  private startEvictionTimer(): void {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => this.evictIdlePools(), 60_000);
    if (typeof this.evictionTimer.unref === "function") this.evictionTimer.unref();
  }

  private evictIdlePools(): void {
    const now = Date.now();
    for (const [name, entry] of this.appPools) {
      if (now - entry.lastUsed > this.idleTimeoutMs) {
        try {
          entry.pool.close();
          this.appPools.delete(name);
          logger.info("Evicted idle database pool", { database: name });
        } catch (err) {
          logger.warn("Failed to evict idle pool", { database: name, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    // Stop the timer if nothing is left to evict
    if (this.appPools.size === 0 && this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  close(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    for (const entry of this.appPools.values()) {
      entry.pool.close();
    }
    this.appPools.clear();
    this.metaPool.close();
  }
}

export default DatabaseManager;
