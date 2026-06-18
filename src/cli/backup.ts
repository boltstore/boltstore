import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { createBackup, restoreFromFile } from "../admin/backup";
import { success, error as cliError, out } from "../cli-style";

export async function backupCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore db:backup --db <database-id> [--label <label>]");
    return;
  }
  const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : undefined;

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found.`);
      return;
    }

    const pool = manager.get(dbId);
    const result = createBackup(pool, dbId, manager.getDataDir(), { label });

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
    cliError("Usage: boltstore db:restore <file> --db <database-id>");
    return;
  }

  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore db:restore <file> --db <database-id>");
    return;
  }

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found.`);
      return;
    }

    const result = restoreFromFile(manager, dbId, filePath);

    success(`Restored database "${result.database}" from ${result.backupPath}`);
    out(`  Restored at: ${result.restoredAt}`);
  } finally {
    manager.close();
  }
}
