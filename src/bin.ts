/**
 * Self-executing CLI entry — starts the server or runs a CLI command.
 *
 * This file is used as the npm `bin` target. It inspects the first argument
 * to decide whether to start the server or run a CLI command. When
 * compiling a standalone binary, `entry.ts` is used instead.
 *
 * Usage:
 *   bun run src/bin.ts serve
 *   bun run src/bin.ts init
 *   bun run src/bin.ts --help
 *
 * @module boltstore/bin
 */

import { runCli } from "./cli";
import { createServer, stopServerBackgroundTasks } from "./server";
import { DatabaseManager } from "./db/manager";
import { autoInitConfig } from "./cli/init";
import { info, success, error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "admin", "applications", "status", "routes", "help", "--help", "-h",
  "migrate", "migrate:rollback", "migrate:list",
  "db:import", "db:export",
  "db:backup", "db:restore",
  "bench",
]);

try {
  if (command && CLI_COMMANDS.has(command)) {
    await runCli(process.argv.slice(2));
  } else {
    // No command or unrecognized arg → start the server
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

    process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
    process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
  }
} catch (err: any) {
  error(err.message);
  error("Set JWT_SECRET environment variable or create a config file with boltstore init.");
  process.exit(1);
}