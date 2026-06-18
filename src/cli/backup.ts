import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { createBackup, restoreFromFile } from "../admin/backup";
import { success, error as cliError, out } from "../cli-style";

export async function backupCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
  const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : undefined;

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbName)) {
      cliError(`Database "${dbName}" not found.`);
      return;
    }

    const pool = manager.get(dbName);
    const result = createBackup(pool, dbName, manager.getDataDir(), { label });

    success(`Backup created: ${result.id}`);
    out(`  Path: ${result.path}`);
    out(`  Size: ${result.sizeBytes} bytes`);
    if (result.label) out(`  Label: ${result.label}`);
  } finally {
    manager.close();
  }
}

export async function restoreCommand(args: string[]): Promise<void> {
  const filePath = args[1];

  if (!filePath) {
    cliError("Usage: boltstore db:restore <file> [--db <path>]");
    return;
  }

  const config = await loadConfig();
  const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbName)) {
      cliError(`Database "${dbName}" not found.`);
      return;
    }

    const result = restoreFromFile(manager, dbName, filePath);

    success(`Restored database "${result.database}" from ${result.backupPath}`);
    out(`  Restored at: ${result.restoredAt}`);
  } finally {
    manager.close();
  }
}
