/**
 * Health check route.
 *
 * @module boltstore/routes/health
 */

import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, type ApiResponse } from "../server";
import pkg from "../../package.json";

export function registerHealthRoutes(
  router: Router,
  manager: DatabaseManager | undefined
): void {
  router.get("/api/health", () => {
    const body: ApiResponse = {
      data: {
        status: "ok",
        version: pkg.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
    return jsonResponse(body);
  });

  router.get("/api/admin/health/detail", async (req) => {
    if (!manager) return jsonResponse({ data: { status: "ok", databases: [] } });
    return jsonResponse({
      data: {
        status: "ok",
        version: pkg.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        databases: manager.listDatabases(),
      },
    });
  });
}