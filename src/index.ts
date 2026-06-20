/**
 * Boltstore — Lightweight backend-as-a-service on SQLite + bun.js
 *
 * @module boltstore
 */

import { createServer, stopServerBackgroundTasks } from "./server";
import { DatabaseManager } from "./db/manager";
import { autoInitConfig } from "./cli/init";
import { info, success, error } from "./cli-style";

let manager: DatabaseManager | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

try {
  const config = await autoInitConfig();

  // Initialize the database manager (manages multiple application databases)
  const dataDir = config.databasePath;
  manager = new DatabaseManager({ dataDir });

  server = createServer({
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
  info(`Data directory: ${dataDir}`);
  info(`Log level: ${config.logLevel}`);
  info(`Timezone: ${config.serverTimezone}`);
  info(`Rate limits: public=${config.rateLimitPublic}/min, auth=${config.rateLimitAuth}/min, admin=${config.rateLimitAdmin}/min`);

  // Set server timezone
  if (config.serverTimezone && config.serverTimezone !== "UTC") {
    process.env.TZ = config.serverTimezone;
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    info("Shutting down...");
    stopServerBackgroundTasks();
    manager?.close();
    server?.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    info("Shutting down...");
    stopServerBackgroundTasks();
    manager?.close();
    server?.stop();
    process.exit(0);
  });
} catch (err: any) {
  error(err.message);
  error("Set JWT_SECRET environment variable or create a config file with boltstore init.");
  process.exit(1);
}

export { server, manager };