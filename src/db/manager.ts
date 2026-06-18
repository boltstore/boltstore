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
 *   dbs_{id}/
 *     db/
 *       dbs_{id}.db          (application database, directory named by database ID)
 *     files/                  (future: per-app file storage)
 * ```
 *
 * Each database gets a unique ID (dbs_ prefix) on creation. The name is
 * kept for display/alias purposes, but the ID is the primary identifier
 * in URLs and file paths.
 *
 * @module boltstore/db/manager
 */

import { DatabasePool } from "./pool";
import { validateIdentifier, isReservedTable, sanitizePathComponent, generateSecureId, ID_PREFIXES } from "@boltstore/utils";
import { mkdirSync, rmSync } from "node:fs";
import { bootstrapAuthTables } from "../auth/tables";

export interface DatabaseInfo {
  /** Unique database ID (dbs_ prefix). */
  id: string;
  /** Human-readable name for display. */
  name: string;
  /** Path to the SQLite file. */
  path: string;
  /** ISO-8601 timestamp of when the database was created. */
  createdAt: string;
  /** ISO-8601 timestamp of last update. */
  updatedAt?: string;
}

export interface ManagerConfig {
  /** Directory where all database files are stored. Default: "./data". */
  dataDir?: string;
}

const DEFAULT_CONFIG: ManagerConfig = {
  dataDir: Bun.env.DATABASE_PATH || "./data",
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
    mkdirSync(this.config.dataDir!, { recursive: true });

    // Create the system directories and meta database
    mkdirSync(`${this.config.dataDir}/system/db`, { recursive: true });

    const metaPath = `${this.config.dataDir}/system/db/_boltstore.db`;
    this.metaPool = new DatabasePool({ path: metaPath, readConnections: 1 });

    // Bootstrap the _databases metadata table with id + name
    this.metaPool.write().run(`
      CREATE TABLE IF NOT EXISTS _databases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      )
    `);

    // Migrate existing schema: add columns and backfill IDs
    const metaWriteDb = this.metaPool.write();
    try { metaWriteDb.run("ALTER TABLE _databases ADD COLUMN updated_at TEXT"); } catch {}
    try { metaWriteDb.run("ALTER TABLE _databases ADD COLUMN id TEXT"); } catch {}

    // Backfill dbs_ IDs for rows that don't have one (created by older versions)
    const rowsWithoutId = metaWriteDb.query("SELECT rowid, name FROM _databases WHERE id IS NULL").all() as { rowid: number; name: string }[];
    for (const row of rowsWithoutId) {
      const dbId = generateSecureId(ID_PREFIXES.database);
      metaWriteDb.run("UPDATE _databases SET id=? WHERE rowid=?", [dbId, row.rowid]);
    }
  }

  /**
   * Resolve a database pool by ID or name.
   * If the identifier starts with "dbs_", it's treated as an ID; otherwise as a name.
   */
  get(nameOrId: string): DatabasePool {
    validateIdentifier(nameOrId.replace(/^dbs_/, ""), "database identifier");

    if (isReservedTable(nameOrId)) {
      throw Object.assign(
        new Error(`Cannot use reserved name "${nameOrId}" as a database identifier.`),
        { status: 403 }
      );
    }

    // The system meta database is always accessible
    if (nameOrId === "_system") {
      return this.metaPool;
    }

    // Check if already loaded
    const cached = this.appPools.get(nameOrId);
    if (cached) return cached;

    // Look up by ID (dbs_ prefix) or name
    const metaDb = this.metaPool.read();
    const isId = nameOrId.startsWith("dbs_");
    const row = metaDb
      .query(isId ? "SELECT path FROM _databases WHERE id=?" : "SELECT path FROM _databases WHERE name=?")
      .get(nameOrId) as { path: string } | null;

    if (!row) {
      throw Object.assign(
        new Error(`Database "${nameOrId}" not found. Use POST /api/admin/databases to create it.`),
        { status: 404 }
      );
    }

    // Create the pool
    const parentMetaQueryTimeoutMs = (this.metaPool as unknown as { config?: { queryTimeoutMs?: number } }).config?.queryTimeoutMs ?? 0;
    const pool = new DatabasePool({ path: row.path, queryTimeoutMs: parentMetaQueryTimeoutMs });
    this.appPools.set(nameOrId, pool);
    return pool;
  }

  /**
   * Create a new application database with a unique ID.
   *
   * This is an **admin-only** operation. A new SQLite file is created
   * in a directory named by the database ID, and registered in `_databases`.
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

    // Check for duplicate name
    const existing = metaDb.query("SELECT 1 FROM _databases WHERE name=?").get(name);
    if (existing) {
      throw Object.assign(
        new Error(`Database "${name}" already exists.`),
        { status: 409 }
      );
    }

    // Generate a unique database ID
    const dbId = generateSecureId(ID_PREFIXES.database);
    const safeId = sanitizePathComponent(dbId);
    mkdirSync(`${this.config.dataDir}/${safeId}/db`, { recursive: true });

    const dbPath = `${this.config.dataDir}/${safeId}/db/${safeId}.db`;
    const now = new Date().toISOString();

    return this.metaPool.writeTransaction(() => {
      metaDb.run("INSERT INTO _databases (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
        dbId,
        name,
        dbPath,
        now,
        now,
      ]);

      // Create the database pool (this auto-creates the SQLite file)
      const parentMetaQueryTimeoutMs = (this.metaPool as unknown as { config?: { queryTimeoutMs?: number } }).config?.queryTimeoutMs ?? 0;
      const pool = new DatabasePool({ path: dbPath, queryTimeoutMs: parentMetaQueryTimeoutMs });
      this.appPools.set(dbId, pool);

      // Auto-create auth tables (_users, _tokens) so the app can use auth immediately
      bootstrapAuthTables(pool);

      return { id: dbId, name, path: dbPath, createdAt: now, updatedAt: now };
    });
  }

  /**
   * Delete an application database by ID or name.
   */
  deleteDatabase(nameOrId: string): void {
    validateIdentifier(nameOrId.replace(/^dbs_/, ""), "database identifier");

    if (nameOrId.startsWith("_")) {
      throw Object.assign(
        new Error(`Cannot delete system database "${nameOrId}".`),
        { status: 403 }
      );
    }

    return this.metaPool.writeTransaction(() => {
      const metaDb = this.metaPool.write();

      const isId = nameOrId.startsWith("dbs_");
      const row = metaDb
        .query(isId ? "SELECT path, name FROM _databases WHERE id=?" : "SELECT path, id FROM _databases WHERE name=?")
        .get(nameOrId) as { path: string; name?: string; id?: string } | null;

      if (!row) {
        throw Object.assign(
          new Error(`Database "${nameOrId}" not found.`),
          { status: 404 }
        );
      }

      // Close and remove the pool if loaded (check both ID and name cache)
      for (const [key, cached] of this.appPools.entries()) {
        if (key === nameOrId || key === row.id || (!isId && key === row.name)) {
          cached.close();
          this.appPools.delete(key);
          break;
        }
      }

      // Remove from metadata
      const lookupField = isId ? "id" : "name";
      metaDb.run(`DELETE FROM _databases WHERE ${lookupField}=?`, [nameOrId]);

      // Remove the app directory
      const dirName = row.path ? row.path.split("/").slice(0, -2).pop() : null;
      if (dirName) {
        const appDir = `${this.config.dataDir}/${dirName}`;
        try {
          rmSync(appDir, { recursive: true, force: true });
        } catch {
          // Best effort cleanup
        }
      }
    });
  }

  /**
   * List all registered application databases.
   */
  listDatabases(): DatabaseInfo[] {
    const metaDb = this.metaPool.read();
    const rows = metaDb.query("SELECT id, name, path, created_at, updated_at FROM _databases ORDER BY name").all() as {
      id: string;
      name: string;
      path: string;
      created_at: string;
      updated_at: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? undefined,
    }));
  }

  /**
   * Check if a database exists by ID or name (metadata check only, no pool created).
   */
  exists(nameOrId: string): boolean {
    const metaDb = this.metaPool.read();
    const isId = nameOrId.startsWith("dbs_");
    const row = metaDb
      .query(isId ? "SELECT 1 FROM _databases WHERE id=?" : "SELECT 1 FROM _databases WHERE name=?")
      .get(nameOrId);
    return row !== null;
  }

  /**
   * Get the data directory path.
   */
  getDataDir(): string {
    return this.config.dataDir!;
  }

  /**
   * Get the system/meta database pool used for global operations.
   */
  getMetaPool(): DatabasePool {
    return this.metaPool;
  }

  /**
   * Close a specific database pool and remove it from the cache.
   */
  closePool(nameOrId: string): void {
    const cached = this.appPools.get(nameOrId);
    if (cached) {
      cached.close();
      this.appPools.delete(nameOrId);
    }
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