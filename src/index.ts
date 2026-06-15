/**
 * Boltstore — Lightweight backend-as-a-service on SQLite + bun.js
 *
 * @module boltstore
 */

import { createServer } from "./server";
import { DatabasePool } from "./db/pool";

const port = parseInt(Bun.env.PORT || "8080", 10);

// Initialize database pool
const dbPath = Bun.env.DATABASE_PATH || "./data/boltstore.db";
const pool = new DatabasePool({ path: dbPath });

const server = createServer({ port, dbPath, pool });

console.log(`[boltstore] Server running on http://localhost:${port}`);
console.log(`[boltstore] Health check: http://localhost:${port}/api/health`);
console.log(`[boltstore] Database: ${dbPath}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[boltstore] Shutting down...");
  pool.close();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[boltstore] Shutting down...");
  pool.close();
  server.stop();
  process.exit(0);
});

export { server, pool };