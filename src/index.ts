/**
 * Boltstore — Lightweight backend-as-a-service on SQLite + bun.js
 *
 * @module boltstore
 */

import { createServer } from "./server";

const port = parseInt(Bun.env.PORT || "8080", 10);

const server = createServer({ port });

console.log(`[boltstore] Server running on http://localhost:${port}`);
console.log(`[boltstore] Health check: http://localhost:${port}/api/health`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[boltstore] Shutting down...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[boltstore] Shutting down...");
  server.stop();
  process.exit(0);
});

export { server };