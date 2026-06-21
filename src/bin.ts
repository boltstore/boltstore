import { runCli } from "./cli";
import { createServer, stopServerBackgroundTasks } from "./server";
import { DatabaseManager } from "./db/manager";
import { autoInitConfig } from "./cli/init";
import { info, success, error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "help", "--help", "-h",
]);

async function detectDevDashboard(): Promise<string | undefined> {
  if (process.env.DEV_DASHBOARD_URL) return process.env.DEV_DASHBOARD_URL;
  try {
    const res = await fetch("http://localhost:5173/dashboard");
    if (res.ok) {
      info("Vite dev server detected — dashboard requests proxied to http://localhost:5173");
      info("Open http://localhost:5173/dashboard in your browser for full HMR support");
      return "http://localhost:5173";
    }
  } catch {}
  return undefined;
}

try {
  if (command && CLI_COMMANDS.has(command)) {
    await runCli(process.argv.slice(2));
  } else {
    const config = await autoInitConfig();
    const manager = new DatabaseManager({ dataDir: config.databasePath });

    const dashboardDevUrl = await detectDevDashboard();

    const server = createServer({
    port: config.port,
    manager,
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

    success(`Server running on http://localhost:${config.port}`);
    info(`Health check: http://localhost:${config.port}/api/health`);
    info(`Data directory: ${config.databasePath}`);
    info(`Log level: ${config.logLevel}`);

    if (config.serverTimezone && config.serverTimezone !== "UTC") {
      process.env.TZ = config.serverTimezone;
    }

    process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
    process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
  }
} catch (err: any) {
  error(err.message);
  error("Server failed to start. Check your config.");
  process.exit(1);
}
