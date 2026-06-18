import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { listMigrations, applyMigrations, rollbackLastMigration } from "../migrations";
import { info, success, error as cliError, out } from "../cli-style";
import { deprecateCommand } from "./help";

export async function migrateCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
  const migrationDir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "./migrations";

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbName)) {
      manager.createDatabase(dbName);
    }

    const pool = manager.get(dbName);
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
  const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbName)) {
      cliError(`Database "${dbName}" not found.`);
      return;
    }

    const pool = manager.get(dbName);
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
  const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbName)) {
      cliError(`Database "${dbName}" not found.`);
      return;
    }

    const pool = manager.get(dbName);
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
