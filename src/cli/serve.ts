import { DatabaseManager } from "../db/manager";
import { createServer, stopServerBackgroundTasks } from "../server";
import { loadConfig } from "../config";
import { autoInitConfig } from "./init";
import { info } from "../cli-style";

export async function serveCommand(): Promise<void> {
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

  info(`Server running on http://localhost:${config.port}`);
  info(`Data directory: ${config.databasePath}`);

  process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
  process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
}
