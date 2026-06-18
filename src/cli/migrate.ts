import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { listMigrations, applyMigrations, rollbackLastMigration } from "../migrations";
import { info, success, error as cliError, out } from "../cli-style";

export async function migrateCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore migrate --db <database-id> [--dir <migrations-dir>]");
    return;
  }
  const migrationDir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "./migrations";

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found. Create it via the admin API first.`);
      return;
    }

    const pool = manager.get(dbId);
    const result = await applyMigrations(pool, migrationDir);

    if (result.applied.length === 0) {
      info("No pending migrations.");
    } else {
      success(`Applied ${result.applied.length} migration(s):`);
      for (const name of result.applied) {
        out(`  ✓ ${name}`);
      }
    }
  } finally {
    manager.close();
  }
}

export async function migrateRollbackCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore migrate:rollback --db <database-id>");
    return;
  }

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found.`);
      return;
    }

    const pool = manager.get(dbId);
    const result = rollbackLastMigration(pool);

    if (result.rolledBack) {
      success(`Rolled back: ${result.rolledBack}`);
    } else {
      info("No migrations to roll back.");
    }
  } finally {
    manager.close();
  }
}

export async function migrateListCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore migrate:list --db <database-id>");
    return;
  }

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found.`);
      return;
    }

    const pool = manager.get(dbId);
    const migrations = listMigrations(pool);

    if (migrations.length === 0) {
      info("No migrations applied.");
    } else {
      out(`Applied migrations (${migrations.length}):`);
      for (const m of migrations) {
        out(`  ${m.name} — ${m.appliedAt}`);
      }
    }
  } finally {
    manager.close();
  }
}
