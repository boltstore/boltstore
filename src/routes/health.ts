/**
 * Health check route.
 *
 * @module boltstore/routes/health
 */

import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { ApiResponse, jsonResponse } from "../server";
import pkg from "../../package.json";

export function registerHealthRoutes(
  router: Router,
  manager: DatabaseManager | undefined
): void {
  router.get("/api/health", () => {
    const databases = manager ? manager.listDatabases() : [];
    const body: ApiResponse = {
      data: {
        status: "ok",
        version: pkg.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        databases: databases.length,
        database_list: databases.map((d) => ({ name: d.name, createdAt: d.createdAt })),
      },
    };
    return jsonResponse(body);
  });
}