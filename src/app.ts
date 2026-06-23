import { createServer, stopServerBackgroundTasks } from "./server";
import { DatabaseManager } from "./db/manager";
import { AnalyticsManager } from "./analytics";
import { autoInitConfig } from "./cli/init";
import { info, success } from "./cli-style";
import { setLogLevel, type LogLevel } from "./logger";
import type { BoltstoreConfig } from "./config";

export interface StartedServer {
  config: BoltstoreConfig;
  manager: DatabaseManager;
  analytics: AnalyticsManager;
  server: ReturnType<typeof Bun.serve>;
  stop: () => void;
}

export async function startServer(): Promise<StartedServer> {
  const config = await autoInitConfig();
  setLogLevel(config.logLevel.toLowerCase() as LogLevel);

  const manager = new DatabaseManager({ dataDir: config.databasePath });
  const analytics = new AnalyticsManager(config.databasePath);
  analytics.startSnapshotTimer(
    () => manager.listDatabases().map(d => d.name),
    (name: string) => {
      try { return manager.getPoolIfExists(name); } catch { return null; }
    },
  );
  manager.setAnalytics(analytics);

  // Detect Vite dev server for dashboard HMR
  let devDashboardUrl: string | undefined;
  if (process.env.DEV_DASHBOARD_URL) {
    devDashboardUrl = process.env.DEV_DASHBOARD_URL;
  } else {
    try {
      const res = await fetch("http://localhost:5173/dashboard");
      if (res.ok) {
        info("Vite dev server detected — dashboard requests proxied to http://localhost:5173");
        devDashboardUrl = "http://localhost:5173";
      }
    } catch {}
  }

  const server = createServer({
    port: config.port,
    manager,
    analytics,
    adminKey: config.adminKey,
    cors: {
      origins: config.corsOrigins,
      methods: config.corsMethods,
      headers: config.corsHeaders,
    },
    maxBodySize: config.maxBodySize,
    requestTimeoutMs: config.requestTimeoutMs,
    trustedProxies: config.trustedProxies,
    devDashboardUrl,
  });

  success(`Server running on http://localhost:${config.port}`);
  info(`Health check: http://localhost:${config.port}/api/health`);
  info(`Data directory: ${config.databasePath}`);
  info(`Log level: ${config.logLevel}`);

  const stop = () => {
    info("Shutting down...");
    stopServerBackgroundTasks();
    analytics.stop();
    manager.close();
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  return { config, manager, analytics, server, stop };
}