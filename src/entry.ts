import { runCli } from "./cli";
import { info, success, error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "help", "--help", "-h",
]);

const isCliCommand = command !== undefined && CLI_COMMANDS.has(command);

try {
  if (isCliCommand) {
    await runCli(process.argv.slice(2));
  } else {
    const { createServer } = await import("./server");
    const { DatabaseManager } = await import("./db/manager");
    const { autoInitConfig } = await import("./cli/init");

    const config = await autoInitConfig();
    const manager = new DatabaseManager({ dataDir: config.databasePath });

    const server = createServer({
      port: config.port,
      manager,
      cors: {
        origins: config.corsOrigins,
        methods: config.corsMethods,
        headers: config.corsHeaders,
      },
      maxBodySize: config.maxBodySize,
      requestTimeoutMs: config.requestTimeoutMs,
    });

    success(`Server running on http://localhost:${config.port}`);

    process.on("SIGINT", () => { info("Shutting down..."); manager.close(); server.stop(); process.exit(0); });
    process.on("SIGTERM", () => { info("Shutting down..."); manager.close(); server.stop(); process.exit(0); });
  }
} catch (err: any) {
  error(err.message);
  error("Server failed to start. Check your config.");
  process.exit(1);
}
