import { error as cliError, out } from "./cli-style";
import { HELP } from "./cli/help";
import { serveCommand } from "./cli/serve";
import { initCommand, autoInitConfig } from "./cli/init";

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
