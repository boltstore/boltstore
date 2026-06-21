import { DatabaseManager } from "../db/manager";
import { createServer, stopServerBackgroundTasks } from "../server";
import { autoInitConfig } from "./init";
import { info } from "../cli-style";

export async function serveCommand(): Promise<void> {
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

  info(`Server running on http://localhost:${config.port}`);
  info(`Data directory: ${config.databasePath}`);

  process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
  process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
}
