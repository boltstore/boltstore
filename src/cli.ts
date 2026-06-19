import { error as cliError, out } from "./cli-style";
import { HELP } from "./cli/help";
import { serveCommand } from "./cli/serve";
import { initCommand, autoInitConfig } from "./cli/init";
import { applicationsCommand } from "./cli/applications";
import { adminCommand } from "./cli/admin";
import { migrateCommand, migrateRollbackCommand, migrateListCommand } from "./cli/migrate";
import { importCommand, exportCommand } from "./cli/import-export";
import { backupCommand, restoreCommand } from "./cli/backup";
import { statusCommand } from "./cli/status";
import { routesCommand } from "./cli/routes";
import { benchCommand } from "./cli/bench";


export async function runCli(args: string[]): Promise<void> {
  const command = args[0];

  try {
    if (command !== "help" && command !== "--help" && command !== "-h") {
      await autoInitConfig();
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

    case "db:import":
      await importCommand(args);
      break;

    case "db:export":
      await exportCommand(args);
      break;

    case "db:backup":
      await backupCommand(args);
      break;

    case "db:restore":
      await restoreCommand(args);
      break;

    case "routes":
      await routesCommand();
      break;

    case "status":
      await statusCommand();
      break;

    case "bench":
      await benchCommand(args);
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
