import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { importData, exportData } from "../admin/import-export";
import { info, success, warn, error as cliError, out } from "../cli-style";

export async function importCommand(args: string[]): Promise<void> {
  const collection = args[1];
  const filePath = args[2];

  if (!collection || !filePath) {
    cliError("Usage: boltstore db:import <collection> <file> --db <database-id> [--format csv|json]");
    return;
  }

  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore db:import <collection> <file> --db <database-id> [--format csv|json]");
    return;
  }
  const formatArg = args.includes("--format") ? args[args.indexOf("--format") + 1] : undefined;

  let format: "csv" | "json" | undefined;
  if (formatArg === "csv") format = "csv";
  else if (formatArg === "json") format = "json";
  else {
    if (filePath.endsWith(".csv")) format = "csv";
    else format = "json";
  }

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found. Create it via the admin API first.`);
      return;
    }

    const input = await Bun.file(filePath).text();
    const pool = manager.get(dbId);
    const result = importData(pool, collection, input, { format, autoCreate: true });

    if (result.collection) {
      info(`Created collection "${collection}" with auto-detected schema.`);
    }
    success(`Imported ${result.imported} record(s).`);
    if (result.failed > 0) {
      warn(`${result.failed} row(s) failed validation.`);
      if (result.errors) {
        for (const err of result.errors) {
          cliError(`Row ${err.row + 1}: ${err.message}`);
        }
      }
    }
  } finally {
    manager.close();
  }
}

export async function exportCommand(args: string[]): Promise<void> {
  const collection = args[1];

  if (!collection) {
    cliError("Usage: boltstore db:export <collection> --db <database-id> [--format csv|json]");
    return;
  }

  const config = await loadConfig();
  const dbId = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;
  if (!dbId) {
    cliError("Usage: boltstore db:export <collection> --db <database-id> [--format csv|json]");
    return;
  }
  const formatArg = args.includes("--format") ? args[args.indexOf("--format") + 1] : "json";
  const format: "csv" | "json" = (formatArg === "csv" ? "csv" : "json");

  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    if (!manager.exists(dbId)) {
      cliError(`Database "${dbId}" not found.`);
      return;
    }

    const pool = manager.get(dbId);
    const result = exportData(pool, collection, { format });

    if (format === "csv") {
      process.stdout.write(result.data);
    } else {
      out(result.data);
    }
  } finally {
    manager.close();
  }
}
