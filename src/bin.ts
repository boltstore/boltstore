import { runCli } from "./cli";
import { startServer } from "./app";
import { error } from "./cli-style";

const command = process.argv[2];

const CLI_COMMANDS = new Set([
  "serve", "init", "help", "--help", "-h",
]);

async function detectDevDashboard(): Promise<string | undefined> {
  if (process.env.DEV_DASHBOARD_URL) return process.env.DEV_DASHBOARD_URL;
  try {
    const res = await fetch("http://localhost:5173/dashboard");
    if (res.ok) {
      const { info } = await import("./cli-style");
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
    await startServer();
  }
} catch (err: unknown) {
  error(err instanceof Error ? err.message : String(err));
  error("Server failed to start. Check your config.");
  process.exit(1);
}