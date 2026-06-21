import { DatabasePool } from "./pool";

export const SCHEMA_VERSION = 1;

export interface DatabaseInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
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
  private appPools: Map<string, DatabasePool> = new Map();

  constructor(config?: ManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const { mkdirSync } = require("node:fs");
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
        username TEXT NOT NULL UNIQUE,
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
        token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
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
    if (cached) return cached;

    const metaDb = this.metaPool.read();
    const row = metaDb.query("SELECT file_path FROM _databases WHERE name=?").get(name) as { file_path: string } | null;
    if (!row) {
      throw Object.assign(new Error(`Database "${name}" not found.`), { status: 404 });
    }

    const pool = new DatabasePool({ path: row.file_path });
    this.appPools.set(name, pool);
    return pool;
  }

  createDatabase(name: string): DatabaseInfo {
    const { mkdirSync } = require("node:fs");
    const path = `${this.config.dataDir}/${name}.db`;

    const metaDb = this.metaPool.write();
    const existing = metaDb.query("SELECT 1 FROM _databases WHERE name=?").get(name);
    if (existing) {
      throw Object.assign(new Error(`Database "${name}" already exists.`), { status: 409 });
    }

    const now = new Date().toISOString();
    metaDb.run("INSERT INTO _databases (name, file_path, created_at) VALUES (?, ?, ?)", [name, path, now]);
    const pool = new DatabasePool({ path });
    this.appPools.set(name, pool);

    return { id: name, name, path, createdAt: now };
  }

  registerDatabase(name: string, filePath: string): DatabasePool {
    const metaDb = this.metaPool.write();
    const existing = metaDb.query("SELECT 1 FROM _databases WHERE name=?").get(name);
    if (existing) {
      throw Object.assign(new Error(`Database "${name}" already exists.`), { status: 409 });
    }
    const now = new Date().toISOString();
    metaDb.run("INSERT INTO _databases (name, file_path, created_at) VALUES (?, ?, ?)", [name, filePath, now]);
    const pool = new DatabasePool({ path: filePath });
    this.appPools.set(name, pool);
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
      cached.close();
      this.appPools.delete(name);
    }

    metaDb.run("DELETE FROM _databases WHERE name=?", [name]);

    try {
      const { rmSync } = require("node:fs");
      rmSync(row.file_path, { force: true });
    } catch {}
  }

  listDatabases(): DatabaseInfo[] {
    const metaDb = this.metaPool.read();
    const rows = metaDb.query("SELECT name, file_path, created_at FROM _databases ORDER BY name").all() as {
      name: string;
      file_path: string;
      created_at: string;
    }[];
    return rows.map((r) => ({ id: r.name, name: r.name, path: r.file_path, createdAt: r.created_at }));
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

  closePool(name: string): void {
    const cached = this.appPools.get(name);
    if (cached) {
      cached.close();
      this.appPools.delete(name);
    }
  }

  close(): void {
    for (const pool of this.appPools.values()) {
      pool.close();
    }
    this.appPools.clear();
    this.metaPool.close();
  }
}

export default DatabaseManager;
