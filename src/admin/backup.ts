/**
 * Backup & Restore module for Boltstore databases.
 *
 * Creates SQLite backup snapshots via `VACUUM INTO` and supports
 * restoring from those snapshots. Restore closes the existing pool
 * (dropping all connections), swaps the database file, and reopens.
 *
 * @module boltstore/admin/backup
 */

import { Database } from "bun:sqlite";
import { DatabasePool } from "../db/pool";
import { DatabaseManager } from "../db/manager";
import { validateIdentifier, resolveSafePath, sanitizePathComponent, generateSecureId } from "@boltstore/utils";

/** Wrap a path traversal error as a 400 response-like error. */
function safeResolvePath(baseDir: string, relative: string): string {
  try {
    return resolveSafePath(baseDir, relative);
  } catch {
    throw Object.assign(
      new Error(`Invalid or unsafe path "${relative}".`),
      { status: 400 }
    );
  }
}
import { mkdirSync, rmSync, existsSync, readFileSync, copyFileSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupOptions {
  /** Human-readable label for this backup. */
  label?: string;
}

export interface BackupInfo {
  /** Unique backup identifier (generated). */
  id: string;
  /** Full filesystem path to the backup file. */
  path: string;
  /** Size of the backup file in bytes. */
  sizeBytes: number;
  /** ISO-8601 timestamp of when the backup was created. */
  createdAt: string;
  /** Optional human-readable label. */
  label?: string;
}

export interface RestoreResult {
  /** Database name that was restored. */
  database: string;
  /** Path to the backup file that was used. */
  backupPath: string;
  /** ISO-8601 timestamp of when the restore occurred. */
  restoredAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bootstrap the _backups metadata table. */
const BOOTSTRAP_BACKUPS = `CREATE TABLE IF NOT EXISTS _backups (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  label TEXT
)`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique backup ID. */
function generateBackupId(): string {
  return generateSecureId("bkp");
}

/** Verify a SQLite backup file by opening it read-only and running PRAGMA integrity_check. */
function verifyBackupIntegrity(path: string): void {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const result = db.query("PRAGMA integrity_check").get() as { integrity_check?: string } | null;
    if (!result || result.integrity_check !== "ok") {
      throw Object.assign(
        new Error(`Backup integrity check failed: ${result?.integrity_check ?? "unknown error"}.`),
        { status: 400 }
      );
    }
  } finally {
    db?.close();
  }
}

/** Replace the live database file with a verified backup, keeping a `.pre-restore` copy. */
function swapDatabaseFile(safeBackupPath: string, safeDbPath: string): void {
  const preRestorePath = `${safeDbPath}.pre-restore`;
  try {
    copyFileSync(safeDbPath, preRestorePath);
  } catch {
    // Best effort; continue even if pre-restore copy fails.
  }

  verifyBackupIntegrity(safeBackupPath);
  copyFileSync(safeBackupPath, safeDbPath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a backup of a database using SQLite's `VACUUM INTO`.
 *
 * The backup is a self-contained, consistent SQLite snapshot stored in
 * `data/{app}/backups/{app}-{timestamp}.db`. Metadata is recorded in the
 * `_backups` table for later listing and restore.
 *
 * `POST /api/admin/:database/backup`
 */
export function createBackup(
  pool: DatabasePool,
  databaseName: string,
  dataDir: string,
  options: BackupOptions = {}
): BackupInfo {
  validateIdentifier(databaseName, "database name");

  // Ensure _backups table exists
  const db = pool.write();
  db.run(BOOTSTRAP_BACKUPS);

  // Ensure backups directory exists
  const safeName = sanitizePathComponent(databaseName);
  const backupsDir = safeResolvePath(dataDir, `${safeName}/backups`);
  mkdirSync(backupsDir, { recursive: true });

  // Generate backup file name
  const id = generateBackupId();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${backupsDir}/${safeName}-${timestamp}.db`;

  // VACUUM INTO cannot run inside a transaction — execute it directly
  const writeDb = pool.write();
  writeDb.run(`VACUUM INTO ?`, [backupPath]);

  // Get file size
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(backupPath).size;
  } catch {
    // Best effort
  }

  const now = new Date().toISOString();

  // Record in _backups (inside a transaction is fine for metadata)
  pool.writeTransaction(() => {
    pool.write().run(
      `INSERT INTO _backups (id, path, size_bytes, created_at, label) VALUES (?, ?, ?, ?, ?)`,
      [id, backupPath, sizeBytes, now, options.label || null]
    );
  });

  return {
    id,
    path: backupPath,
    sizeBytes,
    createdAt: now,
    label: options.label,
  };
}

/**
 * List all backups for a database.
 *
 * `GET /api/admin/:database/backups`
 */
export function listBackups(pool: DatabasePool): BackupInfo[] {
  const db = pool.read();

  // Check if _backups table exists
  const tableExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_backups'")
    .get();
  if (!tableExists) return [];

  const rows = db
    .query("SELECT id, path, size_bytes, created_at, label FROM _backups ORDER BY created_at DESC")
    .all() as {
      id: string;
      path: string;
      size_bytes: number;
      created_at: string;
      label: string | null;
    }[];

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
    label: r.label || undefined,
  }));
}

/**
 * Get a specific backup by ID.
 */
export function getBackup(pool: DatabasePool, backupId: string): BackupInfo {
  const db = pool.read();

  // Check if _backups table exists
  const tableExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_backups'")
    .get();
  if (!tableExists) {
    throw Object.assign(new Error(`Backup "${backupId}" not found.`), { status: 404 });
  }

  const row = db
    .query("SELECT id, path, size_bytes, created_at, label FROM _backups WHERE id=?")
    .get(backupId) as {
      id: string;
      path: string;
      size_bytes: number;
      created_at: string;
      label: string | null;
    } | null;

  if (!row) {
    throw Object.assign(new Error(`Backup "${backupId}" not found.`), { status: 404 });
  }

  return {
    id: row.id,
    path: row.path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    label: row.label || undefined,
  };
}

/**
 * Restore a database from a backup snapshot.
 *
 * **This closes the existing connection pool**, swaps the database file
 * with the backup, then reopens the pool. All active connections to the
 * database will be dropped — suitable for maintenance windows.
 *
 * After restore, the `_backups` metadata table persists because it lives
 * inside the backup snapshot itself.
 *
 * `POST /api/admin/:database/restore/:backupId`
 */
export function restoreBackup(
  manager: DatabaseManager,
  databaseId: string,
  backupId: string
): RestoreResult {
  if (!databaseId.startsWith("dbs_")) {
    throw Object.assign(
      new Error(`Database identifier must start with "dbs_". Use the database ID, not the name.`),
      { status: 400 }
    );
  }

  // First, get the backup info by reading the live database
  const pool = manager.get(databaseId);
  const backup = getBackup(pool, backupId);

  // Verify the backup file exists on disk
  const safeBackupPath = safeResolvePath(manager.getDataDir(), backup.path);
  if (!existsSync(safeBackupPath)) {
    throw Object.assign(
      new Error(`Backup file not found at "${backup.path}". The file may have been deleted.`),
      { status: 404 }
    );
  }

  // Get the database path before closing
  const dbInfo = manager.listDatabases().find((d) => d.id === databaseId);
  if (!dbInfo) {
    throw Object.assign(new Error(`Database "${databaseId}" not found.`), { status: 404 });
  }

  const safeDbPath = safeResolvePath(manager.getDataDir(), dbInfo.path);

  // Close the existing pool (drops all connections)
  manager.closePool(databaseId);

  // Copy backup file over the live database file
  try {
    swapDatabaseFile(safeBackupPath, safeDbPath);
  } catch (err) {
    // Try to reopen the original pool on failure
    manager.get(databaseId);
    throw Object.assign(
      new Error(`Failed to restore from backup: ${(err as Error).message}`),
      { status: (err as { status?: number }).status || 500 }
    );
  }

  // Reopen the pool (this will create a fresh DatabasePool at the existing path)
  manager.get(databaseId);

  return {
    database: databaseId,
    backupPath: backup.path,
    restoredAt: new Date().toISOString(),
  };
}

/**
 * Restore a database directly from a file path (CLI usage).
 *
 * Useful when the backup file is not tracked in `_backups` metadata,
 * e.g., a backup copied from another machine.
 */
export function restoreFromFile(
  manager: DatabaseManager,
  databaseId: string,
  backupFilePath: string
): RestoreResult {
  if (!databaseId.startsWith("dbs_")) {
    throw Object.assign(
      new Error(`Database identifier must start with "dbs_". Use the database ID, not the name.`),
      { status: 400 }
    );
  }

  // Verify the backup file exists and is inside the data directory
  const safeBackupPath = safeResolvePath(manager.getDataDir(), backupFilePath);
  if (!existsSync(safeBackupPath)) {
    throw Object.assign(
      new Error(`Backup file not found at "${backupFilePath}".`),
      { status: 404 }
    );
  }

  // Verify it looks like a SQLite database
  const headerBytes = readFileSync(safeBackupPath);
  const header = Buffer.from(headerBytes.subarray(0, 16)).toString("utf8");
  if (!header.startsWith("SQLite format 3")) {
    throw Object.assign(
      new Error(`File at "${backupFilePath}" is not a valid SQLite database.`),
      { status: 400 }
    );
  }

  // Get the database path
  const dbInfo = manager.listDatabases().find((d) => d.id === databaseId);
  if (!dbInfo) {
    throw Object.assign(new Error(`Database "${databaseId}" not found.`), { status: 404 });
  }
  const safeDbPath = safeResolvePath(manager.getDataDir(), dbInfo.path);

  // Close the existing pool
  manager.closePool(databaseId);

  // Copy backup file over the live database file
  try {
    swapDatabaseFile(safeBackupPath, safeDbPath);
  } catch (err) {
    manager.get(databaseId);
    throw Object.assign(
      new Error(`Failed to restore from file: ${(err as Error).message}`),
      { status: (err as { status?: number }).status || 500 }
    );
  }

  // Reopen
  manager.get(databaseId);

  return {
    database: databaseId,
    backupPath: backupFilePath,
    restoredAt: new Date().toISOString(),
  };
}