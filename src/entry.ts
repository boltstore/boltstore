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

const command = process.argv[2];

// If the first arg is a known CLI command, run the CLI.
// Otherwise (including when there are no args), start the server.
const isCliCommand = [
  "serve",
  "init",
  "migrate",
  "migrate:rollback",
  "migrations",
  "status",
  "help",
  "--help",
  "-h",
].includes(command);

if (isCliCommand) {
  await runCli(process.argv.slice(2));
} else {
  // Start the server (import dynamically to avoid loading the server for CLI commands)
  const { createServer } = await import("./server");
  const { DatabaseManager } = await import("./db/manager");
  const { loadConfig } = await import("./config");

  const config = await loadConfig();
  const manager = new DatabaseManager({ dataDir: config.databasePath });

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
  console.log(`[boltstore] Data directory: ${config.databasePath}`);
  console.log(`[boltstore] Log level: ${config.logLevel}`);
  console.log(`[boltstore] Timezone: ${config.serverTimezone}`);

  if (config.serverTimezone && config.serverTimezone !== "UTC") {
    process.env.TZ = config.serverTimezone;
  }

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
}