import { runCli } from "./cli";
import { startServer } from "./app";
import { error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "help", "--help", "-h",
]);

const isCliCommand = command !== undefined && CLI_COMMANDS.has(command);

try {
  if (isCliCommand) {
    await runCli(process.argv.slice(2));
  } else {
    await startServer();
  }
} catch (err: unknown) {
  error(err instanceof Error ? err.message : String(err));
  error("Server failed to start. Check your config.");
  process.exit(1);
}