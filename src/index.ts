import { startServer, type StartedServer } from "./app";
import { error } from "./cli-style";

let started: StartedServer | undefined;

try {
  started = await startServer();
} catch (err: unknown) {
  error(err instanceof Error ? err.message : String(err));
  error("Server failed to start. Check your config.");
  process.exit(1);
}

export const server = started?.server;
export const manager = started?.manager;
export const analytics = started?.analytics;