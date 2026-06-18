import { error as cliError, out } from "./cli-style";
import { HELP, deprecateCommand } from "./cli/help";
import { serveCommand } from "./cli/serve";
import { initCommand } from "./cli/init";
import { applicationsCommand } from "./cli/applications";
import { adminCommand } from "./cli/admin";
import { migrateCommand, migrateRollbackCommand, migrateListCommand } from "./cli/migrate";
import { importCommand, exportCommand } from "./cli/import-export";
import { backupCommand, restoreCommand } from "./cli/backup";
import { statusCommand } from "./cli/status";

const NO_CONFIG_COMMANDS = new Set(["init", "admin", "help", "--help", "-h"]);

async function checkConfigExists(): Promise<void> {
  for (const candidate of ["boltstore.yaml", "boltstore.yml", "boltstore.json"]) {
    try {
      if (await Bun.file(candidate).exists()) return;
    } catch {
      // Skip
    }
  }
  cliError("No config file found. Run boltstore init first to create one.");
  process.exit(1);
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];

  try {
    if (!NO_CONFIG_COMMANDS.has(command)) {
      await checkConfigExists();
    }

    switch (command) {
    case "serve":
      await serveCommand();
      break;

    case "init":
      await initCommand(args);
      break;

    case "applications":
      await applicationsCommand(args);
      break;

    case "admin":
      await adminCommand(args);
      break;

    case "migrate":
      await migrateCommand(args);
      break;

    case "migrate:rollback":
      await migrateRollbackCommand(args);
      break;

    case "migrate:list":
      await migrateListCommand(args);
      break;

    case "migrations":
      deprecateCommand("migrations", "migrate:list");
      await migrateListCommand(args);
      break;

    case "db:import":
      await importCommand(args);
      break;

    case "import":
      deprecateCommand("import", "db:import");
      await importCommand(args);
      break;

    case "db:export":
      await exportCommand(args);
      break;

    case "export":
      deprecateCommand("export", "db:export");
      await exportCommand(args);
      break;

    case "db:backup":
      await backupCommand(args);
      break;

    case "backup":
      deprecateCommand("backup", "db:backup");
      await backupCommand(args);
      break;

    case "db:restore":
      await restoreCommand(args);
      break;

    case "restore":
      deprecateCommand("restore", "db:restore");
      await restoreCommand(args);
      break;

    case "status":
      await statusCommand();
      break;

    case "--help":
    case "-h":
    case "help":
    default:
      out(HELP);
      break;
    }
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    if (e.message) {
      cliError(e.message);
    } else {
      cliError(String(err));
    }
    process.exit(1);
  }
}
