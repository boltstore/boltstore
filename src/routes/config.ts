import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";

export function registerConfigRoutes(router: Router, manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/databases/:name/config", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const row = metaPool.read().query("SELECT config FROM _databases WHERE name = ?").get(params.name) as { config: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);
    return jsonResponse({ data: JSON.parse(row.config) });
  });

  router.patch("/api/databases/:name/config", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await req.json() as Record<string, any>;

    const row = metaPool.read().query("SELECT config FROM _databases WHERE name = ?").get(params.name) as { config: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);

    const current = JSON.parse(row.config);
    const updated = { ...current, ...body };

    metaPool.write().run("UPDATE _databases SET config = ? WHERE name = ?", [JSON.stringify(updated), params.name]);
    logActivity(manager, { action: "database.config.update", admin_id: getAdminId(req, manager), database_name: params.name, details: { from: current, to: updated, changes: body }, ip: getClientIp(req) });
    return jsonResponse({ data: updated });
  });
}
