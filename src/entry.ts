/**
 * Binary entry point — routes to CLI or server based on argv.
 *
 * This is the file referenced by `bun build --compile`. It inspects
 * the first argument to decide whether to start the server or run
 * a CLI command.
 *
 * @module boltstore/entry
 */

import { runCli } from "./cli";
import { info, success, error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "admin", "applications", "status", "help", "--help", "-h",
  "migrate", "migrate:rollback", "migrate:list", "migrations",
  "import", "export", "db:import", "db:export",
  "backup", "restore", "db:backup", "db:restore",
]);

const isCliCommand = command !== undefined && CLI_COMMANDS.has(command);

try {
  if (isCliCommand) {
    await runCli(process.argv.slice(2));
  } else {
    // Start the server (import dynamically to avoid loading the server for CLI commands)
    const { createServer } = await import("./server");
    const { DatabaseManager } = await import("./db/manager");
    const { autoInitConfig } = await import("./cli/init");

    const config = await autoInitConfig();
    const manager = new DatabaseManager({ dataDir: config.databasePath });

    const server = createServer({
      port: config.port,
      manager,
      auth: { secret: config.jwtSecret },
      cors: {
        origins: config.corsOrigins,
        methods: config.corsMethods,
        headers: config.corsHeaders,
      },
      rateLimit: {
        public: config.rateLimitPublic,
        auth: config.rateLimitAuth,
        admin: config.rateLimitAdmin,
        windowSeconds: config.rateLimitWindowSeconds,
      },
      maxBodySize: config.maxBodySize,
      requestTimeoutMs: config.requestTimeoutMs,
      maxBatchSize: config.maxBatchSize,
      trustedProxies: config.trustedProxies,
      enableRealtime: config.enableRealtime,
      enableSync: config.enableSync,
    });

    success(`Server running on http://localhost:${config.port}`);
    info(`Health check: http://localhost:${config.port}/api/health`);
    info(`Data directory: ${config.databasePath}`);
    info(`Log level: ${config.logLevel}`);
    info(`Timezone: ${config.serverTimezone}`);
    info(`Rate limits: public=${config.rateLimitPublic}/min, auth=${config.rateLimitAuth}/min, admin=${config.rateLimitAdmin}/min`);

    if (config.serverTimezone && config.serverTimezone !== "UTC") {
      process.env.TZ = config.serverTimezone;
    }

    const { stopServerBackgroundTasks } = await import("./server");

    process.on("SIGINT", () => {
      info("Shutting down...");
      stopServerBackgroundTasks();
      manager.close();
      server.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      info("Shutting down...");
      stopServerBackgroundTasks();
      manager.close();
      server.stop();
      process.exit(0);
    });
  }
} catch (err: any) {
  error(err.message);
  error("Set JWT_SECRET environment variable or create a config file with boltstore init.");
  process.exit(1);
}