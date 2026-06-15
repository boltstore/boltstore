/**
 * Boltstore — Lightweight backend-as-a-service on SQLite + bun.js
 *
 * @module boltstore
 */

import { createServer } from "./server";
import { DatabaseManager } from "./db/manager";
import { loadConfig } from "./config";

const config = await loadConfig();

// Initialize the database manager (manages multiple application databases)
const dataDir = config.databasePath;
const manager = new DatabaseManager({ dataDir });

const server = createServer({
  port: config.port,
  manager,
  cors: {
    origins: config.corsOrigins,
    methods: config.corsMethods,
    headers: config.corsHeaders,
  },
});

console.log(`[boltstore] Server running on http://localhost:${config.port}`);
console.log(`[boltstore] Health check: http://localhost:${config.port}/api/health`);
console.log(`[boltstore] Data directory: ${dataDir}`);
console.log(`[boltstore] Log level: ${config.logLevel}`);
console.log(`[boltstore] Timezone: ${config.serverTimezone}`);

// Set server timezone
if (config.serverTimezone && config.serverTimezone !== "UTC") {
  process.env.TZ = config.serverTimezone;
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[boltstore] Shutting down...");
  manager.close();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[boltstore] Shutting down...");
  manager.close();
  server.stop();
  process.exit(0);
});

export { server, manager };
