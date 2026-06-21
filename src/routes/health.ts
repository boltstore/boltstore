import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse } from "../server";
import pkg from "../../package.json";

export function registerHealthRoutes(router: Router, manager: DatabaseManager | undefined): void {
  router.get("/api/health", () => {
    const databases = manager?.listDatabases().length ?? 0;
    return jsonResponse({
      status: "ok",
      version: pkg.version,
      databases,
    });
  });
}
