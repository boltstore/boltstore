import { createServer, stopServerBackgroundTasks } from "./server";
import { DatabaseManager } from "./db/manager";
import { autoInitConfig } from "./cli/init";
import { info, success, error } from "./cli-style";

let manager: DatabaseManager | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

try {
  const config = await autoInitConfig();

  const dataDir = config.databasePath;
  manager = new DatabaseManager({ dataDir });

  server = createServer({
    port: config.port,
    manager,
    adminKey: config.adminKey,
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
  info(`Data directory: ${dataDir}`);
  info(`Log level: ${config.logLevel}`);

  if (config.serverTimezone && config.serverTimezone !== "UTC") {
    process.env.TZ = config.serverTimezone;
  }

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
  error("Server failed to start. Check your config.");
  process.exit(1);
}

export { server, manager };
