/**
 * Boltstore — Lightweight backend-as-a-service on SQLite + bun.js
 *
 * @module boltstore
 */

import { createServer } from "./server";
import { DatabaseManager } from "./db/manager";

const port = parseInt(Bun.env.PORT || "8080", 10);

// Initialize the database manager (manages multiple application databases)
const dataDir = Bun.env.DATABASE_PATH
  ? Bun.env.DATABASE_PATH.substring(0, Bun.env.DATABASE_PATH.lastIndexOf("/")) || "./data"
  : "./data";
const manager = new DatabaseManager({ dataDir });

const server = createServer({ port, manager });

console.log(`[boltstore] Server running on http://localhost:${port}`);
console.log(`[boltstore] Health check: http://localhost:${port}/api/health`);
console.log(`[boltstore] Data directory: ${dataDir}`);

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