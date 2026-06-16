/**
 * Backup & Restore module for Boltstore databases.
 *
 * Creates SQLite backup snapshots via `VACUUM INTO` and supports
 * restoring from those snapshots. Restore closes the existing pool
 * (dropping all connections), swaps the database file, and reopens.
 *
 * @module boltstore/admin/backup
 */

import { DatabasePool } from "../db/pool";
import { DatabaseManager } from "../db/manager";
import { validateIdentifier } from "@boltstore/utils";

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
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `bkp_${ts}_${rnd}`;
}

/** Escapes a string for safe use in a filesystem path by replacing characters
 *  that could cause path traversal or filesystem issues. */
function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
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
  const backupsDir = `${dataDir}/${sanitizePathComponent(databaseName)}/backups`;
  Bun.spawnSync(["mkdir", "-p", backupsDir]);

  // Generate backup file name
  const id = generateBackupId();
  const safeName = sanitizePathComponent(databaseName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${backupsDir}/${safeName}-${timestamp}.db`;

  // VACUUM INTO cannot run inside a transaction — execute it directly
  const writeDb = pool.write();
  writeDb.run(`VACUUM INTO ?`, [backupPath]);

  // Get file size
  let sizeBytes = 0;
  try {
    const stat = Bun.spawnSync(["stat", "-f", "%z", backupPath]);
    if (stat.exitCode === 0) {
      sizeBytes = parseInt(stat.stdout.toString().trim(), 10) || 0;
    }
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
  databaseName: string,
  backupId: string
): RestoreResult {
  validateIdentifier(databaseName, "database name");

  // First, get the backup info by reading the live database
  const pool = manager.get(databaseName);
  const backup = getBackup(pool, backupId);

  // Verify the backup file exists on disk
  const backupFile = Bun.file(backup.path);
  if (!backupFile.size) {
    // Try to check existence via stat
    const stat = Bun.spawnSync(["test", "-f", backup.path]);
    if (stat.exitCode !== 0) {
      throw Object.assign(
        new Error(`Backup file not found at "${backup.path}". The file may have been deleted.`),
        { status: 404 }
      );
    }
  }

  // Get the database path before closing
  const dbInfo = manager.listDatabases().find((d) => d.name === databaseName);
  if (!dbInfo) {
    throw Object.assign(new Error(`Database "${databaseName}" not found.`), { status: 404 });
  }

  // Close the existing pool (drops all connections)
  manager.closePool(databaseName);

  // Copy backup file over the live database file
  try {
    Bun.spawnSync(["cp", backup.path, dbInfo.path]);
  } catch (err) {
    // Try to reopen the original pool on failure
    manager.get(databaseName);
    throw Object.assign(
      new Error(`Failed to restore from backup: ${(err as Error).message}`),
      { status: 500 }
    );
  }

  // Reopen the pool (this will create a fresh DatabasePool at the existing path)
  manager.get(databaseName);

  return {
    database: databaseName,
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
  databaseName: string,
  backupFilePath: string
): RestoreResult {
  validateIdentifier(databaseName, "database name");

  // Verify the backup file exists
  const stat = Bun.spawnSync(["test", "-f", backupFilePath]);
  if (stat.exitCode !== 0) {
    throw Object.assign(
      new Error(`Backup file not found at "${backupFilePath}".`),
      { status: 404 }
    );
  }

  // Verify it looks like a SQLite database
  const header = Bun.spawnSync(["head", "-c", "16", backupFilePath]);
  const magic = header.stdout.toString();
  if (!magic.startsWith("SQLite format 3")) {
    throw Object.assign(
      new Error(`File at "${backupFilePath}" is not a valid SQLite database.`),
      { status: 400 }
    );
  }

  // Get the database path
  const dbInfo = manager.listDatabases().find((d) => d.name === databaseName);
  if (!dbInfo) {
    throw Object.assign(new Error(`Database "${databaseName}" not found.`), { status: 404 });
  }

  // Close the existing pool
  manager.closePool(databaseName);

  // Copy backup file over the live database file
  try {
    Bun.spawnSync(["cp", backupFilePath, dbInfo.path]);
  } catch (err) {
    manager.get(databaseName);
    throw Object.assign(
      new Error(`Failed to restore from file: ${(err as Error).message}`),
      { status: 500 }
    );
  }

  // Reopen
  manager.get(databaseName);

  return {
    database: databaseName,
    backupPath: backupFilePath,
    restoredAt: new Date().toISOString(),
  };
}