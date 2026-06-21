import { runCli } from "./cli";
import { createServer, stopServerBackgroundTasks } from "./server";
import { DatabaseManager } from "./db/manager";
import { autoInitConfig } from "./cli/init";
import { info, success, error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "help", "--help", "-h",
]);

try {
  if (command && CLI_COMMANDS.has(command)) {
    await runCli(process.argv.slice(2));
  } else {
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
    info(`Health check: http://localhost:${config.port}/api/health`);
    info(`Data directory: ${config.databasePath}`);
    info(`Log level: ${config.logLevel}`);

    if (config.serverTimezone && config.serverTimezone !== "UTC") {
      process.env.TZ = config.serverTimezone;
    }

    process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
    process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
  }
} catch (err: any) {
  error(err.message);
  error("Server failed to start. Check your config.");
  process.exit(1);
}
