/**
 * DatabaseManager — manages multiple application databases.
 *
 * Directory layout:
 * ```
 * data/
 *   system/
 *     db/
 *       _boltstore.db       (server meta database — _databases table)
 *     files/                 (future: system-level file storage)
 *   {app}/
 *     db/
 *       {app}.db             (application database)
 *     files/                  (future: per-app file storage)
 * ```
 *
 * @module boltstore/db/manager
 */

import { DatabasePool } from "./pool";
import { validateIdentifier, isReservedTable } from "@boltstore/utils";

export interface DatabaseInfo {
  /** Application (database) name. */
  name: string;
  /** Path to the SQLite file. */
  path: string;
  /** ISO-8601 timestamp of when the database was created. */
  createdAt: string;
}

export interface ManagerConfig {
  /** Directory where all database files are stored. Default: "./data". */
  dataDir?: string;
}

const DEFAULT_CONFIG: ManagerConfig = {
  dataDir: Bun.env.DATABASE_PATH
    ? Bun.env.DATABASE_PATH.substring(0, Bun.env.DATABASE_PATH.lastIndexOf("/")) || "./data"
    : "./data",
};

/**
 * Manages multiple application databases.
 *
 * Each application gets an isolated SQLite file with its own connection pool.
 * A shared meta database tracks registered applications in the `_databases` table.
 */
export class DatabaseManager {
  private config: ManagerConfig;
  private metaPool: DatabasePool;
  private appPools: Map<string, DatabasePool> = new Map();

  constructor(config?: ManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure data directory exists
    Bun.spawnSync(["mkdir", "-p", this.config.dataDir!]);

    // Create the system directories and meta database
    Bun.spawnSync(["mkdir", "-p", `${this.config.dataDir}/system/db`]);

    const metaPath = `${this.config.dataDir}/system/db/_boltstore.db`;
    this.metaPool = new DatabasePool({ path: metaPath, readConnections: 1 });

    // Bootstrap the _databases metadata table
    this.metaPool.write().run(`
      CREATE TABLE IF NOT EXISTS _databases (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Get (or lazily create) a DatabasePool for the given application.
   *
   * If the application is not registered in `_databases`, this will throw.
   * The application must be explicitly created via `createDatabase()` first.
   */
  get(name: string): DatabasePool {
    validateIdentifier(name, "database name");

    if (isReservedTable(name)) {
      throw Object.assign(
        new Error(`Cannot use reserved name "${name}" as a database name.`),
        { status: 403 }
      );
    }

    // Check if already loaded
    const cached = this.appPools.get(name);
    if (cached) return cached;

    // Verify it exists in metadata
    const metaDb = this.metaPool.read();
    const row = metaDb.query("SELECT path FROM _databases WHERE name=?").get(name) as
      | { path: string }
      | null;

    if (!row) {
      throw Object.assign(
        new Error(`Database "${name}" not found. Use POST /api/admin/databases to create it.`),
        { status: 404 }
      );
    }

    // Create the pool
    const pool = new DatabasePool({ path: row.path });
    this.appPools.set(name, pool);
    return pool;
  }

  /**
   * Create a new application database.
   *
   * This is an **admin-only** operation. A new SQLite file is created
   * and registered in the `_databases` metadata table.
   */
  createDatabase(name: string): DatabaseInfo {
    validateIdentifier(name, "database name");

    if (isReservedTable(name)) {
      throw Object.assign(
        new Error(`Cannot use reserved name "${name}" as a database name.`),
        { status: 403 }
      );
    }

    if (name.startsWith("_")) {
      throw Object.assign(
        new Error(`Database names cannot start with underscore.`),
        { status: 400 }
      );
    }

    const metaDb = this.metaPool.write();

    // Check for duplicate
    const existing = metaDb.query("SELECT 1 FROM _databases WHERE name=?").get(name);
    if (existing) {
      throw Object.assign(
        new Error(`Database "${name}" already exists.`),
        { status: 409 }
      );
    }

    // Create app directory structure
    Bun.spawnSync(["mkdir", "-p", `${this.config.dataDir}/${name}/db`]);

    const dbPath = `${this.config.dataDir}/${name}/db/${name}.db`;
    const now = new Date().toISOString();

    // Use writeTransaction on the meta pool for atomicity
    return this.metaPool.writeTransaction(() => {
      metaDb.run("INSERT INTO _databases (name, path, created_at) VALUES (?, ?, ?)", [
        name,
        dbPath,
        now,
      ]);

      // Create the database pool (this auto-creates the SQLite file)
      const pool = new DatabasePool({ path: dbPath });
      this.appPools.set(name, pool);

      return { name, path: dbPath, createdAt: now };
    });
  }

  /**
   * Delete an application database.
   *
   * This is an **admin-only** operation. The SQLite file is closed and removed,
   * and the entry is deleted from `_databases`.
   */
  deleteDatabase(name: string): void {
    validateIdentifier(name, "database name");

    if (name.startsWith("_")) {
      throw Object.assign(
        new Error(`Cannot delete system database "${name}".`),
        { status: 403 }
      );
    }

    return this.metaPool.writeTransaction(() => {
      const metaDb = this.metaPool.write();

      // Verify it exists
      const row = metaDb.query("SELECT path FROM _databases WHERE name=?").get(name) as
        | { path: string }
        | null;

      if (!row) {
        throw Object.assign(
          new Error(`Database "${name}" not found.`),
          { status: 404 }
        );
      }

      // Close and remove the pool if loaded
      const cached = this.appPools.get(name);
      if (cached) {
        cached.close();
        this.appPools.delete(name);
      }

      // Remove from metadata
      metaDb.run("DELETE FROM _databases WHERE name=?", [name]);

      // Remove the entire app directory (db files + future files dir)
      const appDir = `${this.config.dataDir}/${name}`;
      try {
        Bun.spawnSync(["rm", "-rf", appDir]);
      } catch {
        // Best effort cleanup
      }
    });
  }

  /**
   * List all registered application databases.
   */
  listDatabases(): DatabaseInfo[] {
    const metaDb = this.metaPool.read();
    const rows = metaDb.query("SELECT name, path, created_at FROM _databases ORDER BY name").all() as {
      name: string;
      path: string;
      created_at: string;
    }[];

    return rows.map((r) => ({
      name: r.name,
      path: r.path,
      createdAt: r.created_at,
    }));
  }

  /**
   * Check if a database exists (metadata check only, no pool created).
   */
  exists(name: string): boolean {
    const metaDb = this.metaPool.read();
    const row = metaDb.query("SELECT 1 FROM _databases WHERE name=?").get(name);
    return row !== null;
  }

  /**
   * Close all application database pools and the meta database.
   */
  close(): void {
    for (const pool of this.appPools.values()) {
      pool.close();
    }
    this.appPools.clear();
    this.metaPool.close();
  }
}

export default DatabaseManager;