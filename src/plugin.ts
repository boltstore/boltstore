import type { Router } from "./router";
import type { DatabaseManager } from "./db/manager";
import type { EventEmitter } from "./events";

export interface BoltstorePlugin {
  id: string;
  name: string;
  version: string;
  register(server: PluginServer): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface PluginServer {
  router: Router;
  databaseManager: DatabaseManager;
  events: EventEmitter;
  config: Record<string, unknown>;
}

export function loadPlugin(
  plugin: BoltstorePlugin,
  server: PluginServer
): void | Promise<void> {
  return plugin.register(server);
}
