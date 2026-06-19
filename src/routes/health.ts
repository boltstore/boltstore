/**
 * Health check route.
 *
 * @module boltstore/routes/health
 */

import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, requireAdmin } from "../middleware/auth";
import type { AuthConfig } from "../middleware/auth";
import pkg from "../../package.json";

export function registerHealthRoutes(
  router: Router,
  manager: DatabaseManager | undefined,
  authConfig?: AuthConfig
): void {
  router.get("/api/health", () => {
    return jsonResponse({
      data: {
        status: "ok",
        version: pkg.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    });
  });

  router.get("/api/admin/health/detail", async (req) => {
    if (!manager || !authConfig) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
    const auth = await authenticateRequest(req, manager, "_system", authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;
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