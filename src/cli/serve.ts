import { DatabaseManager } from "../db/manager";
import { AnalyticsManager } from "../analytics";
import { createServer, stopServerBackgroundTasks } from "../server";
import { autoInitConfig } from "./init";
import { info } from "../cli-style";

async function detectDevDashboard(): Promise<string | undefined> {
  if (process.env.DEV_DASHBOARD_URL) return process.env.DEV_DASHBOARD_URL;
  try {
    const res = await fetch("http://localhost:5173/dashboard");
    if (res.ok) {
      info("Vite dev server detected — dashboard requests proxied to http://localhost:5173");
      return "http://localhost:5173";
    }
  } catch {}
  return undefined;
}

export async function serveCommand(): Promise<void> {
  const config = await autoInitConfig();
  const manager = new DatabaseManager({ dataDir: config.databasePath });
  const analytics = new AnalyticsManager(config.databasePath);
  analytics.startSnapshotTimer(() => manager.listDatabases().map(d => d.name));
  manager.setAnalytics(analytics);

  const dashboardDevUrl = await detectDevDashboard();

  const server = createServer({
    port: config.port,
    manager,
    analytics,
    adminKey: config.adminKey,
    devDashboardUrl: dashboardDevUrl,
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

  process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); analytics.stop(); manager.close(); server.stop(); process.exit(0); });
  process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); analytics.stop(); manager.close(); server.stop(); process.exit(0); });
}
