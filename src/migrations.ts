/**
 * Migration system — tracks and applies schema versions.
 *
 * Migrations are stored as numbered SQL files that are applied in order.
 * The `_migrations` system table tracks which migrations have been applied.
 *
 * @module boltstore/migrations
 */

import { DatabasePool } from "./db/pool";
import { resolveSafePath } from "@boltstore/utils";

/** A single migration record. */
export interface Migration {
  /** Migration name (filename without extension). */
  name: string;
  /** When the migration was applied (ISO-8601). */
  appliedAt: string;
}

/**
 * Ensure the `_migrations` system table exists in the database.
 */
function ensureMigrationsTable(db: import("bun:sqlite").Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * List all applied migrations for a database.
 *
 * `GET /api/admin/:database/migrations`
 */
export function listMigrations(pool: DatabasePool): Migration[] {
  const db = pool.read();

  // Check if _migrations exists
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migrations'")
    .get();
  if (!exists) return [];

  const rows = db
    .query("SELECT name, applied_at FROM _migrations ORDER BY name")
    .all() as { name: string; applied_at: string }[];

  return rows.map((r) => ({
    name: r.name,
    appliedAt: r.applied_at,
  }));
}

/**
 * Get pending migrations from a directory.
 *
 * Migrations are files matching `{number}_{name}.sql` where the number
 * is used to determine order. Files are read from the given directory
 * via Bun's file API.
 */
export async function getPendingMigrations(
  pool: DatabasePool,
  migrationDir: string
): Promise<{ name: string; sql: string }[]> {
  const applied = new Set(listMigrations(pool).map((m) => m.name));

  // Read migration files
  let files: string[] = [];
  try {
    // Use glob to find .sql files
    const glob = new Bun.Glob("*.sql");
    for await (const file of glob.scan({ cwd: migrationDir, onlyFiles: true })) {
      files.push(file);
    }
  } catch {
    return [];
  }

  // Filter out already applied and sort by name (which includes the number prefix)
  const pending = files
    .filter((f) => !applied.has(f.replace(/\.sql$/, "")))
    .sort();

  const result: { name: string; sql: string }[] = [];
  for (const file of pending) {
    try {
      const content = await Bun.file(`${migrationDir}/${file}`).text();
      result.push({ name: file.replace(/\.sql$/, ""), sql: content });
    } catch {
      // skip unreadable files
    }
  }

  return result;
}

/**
 * Apply all pending migrations.
 *
 * `POST /api/admin/:database/migrations/up`
 */
export async function applyMigrations(
  pool: DatabasePool,
  migrationDir: string
): Promise<{ applied: string[] }> {
  const pending = await getPendingMigrations(pool, migrationDir);
  const applied: string[] = [];

  pool.writeTransaction(() => {
    const db = pool.write();
    ensureMigrationsTable(db);

    for (const migration of pending) {
      // Split SQL into individual statements and run each
      const statements = migration.sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        db.run(stmt);
      }

      // Record the migration
      const now = new Date().toISOString();
      db.run("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [
        migration.name,
        now,
      ]);

      applied.push(migration.name);
    }
  });

  return { applied };
}

/**
 * Rollback the most recently applied migration.
 *
 * This is a best-effort operation — since there's no way to know
 * the inverse of a migration, this simply removes the last entry
 * from the `_migrations` table. The actual schema changes are NOT
 * reversed. Use the transactions API to restore from a backup for
 * full rollback capability.
 *
 * `POST /api/admin/:database/migrations/down`
 */
export function rollbackLastMigration(
  pool: DatabasePool
): { rolledBack: string | null } {
  const db = pool.write();
  ensureMigrationsTable(db);

  // Get the last applied migration
  const last = db
    .query("SELECT name FROM _migrations ORDER BY name DESC LIMIT 1")
    .get() as { name: string } | null;

  if (!last) {
    return { rolledBack: null };
  }

  db.run("DELETE FROM _migrations WHERE name = ?", [last.name]);
  return { rolledBack: last.name };
}