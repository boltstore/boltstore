import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";
import { validateDbName } from "../validation";

const ALLOWED_CONFIG_KEYS = new Set(["cors_origins", "readonly"]);

export function registerConfigRoutes(router: Router, manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/databases/:name/config", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    const row = metaPool.read().query("SELECT config FROM _databases WHERE name = ?").get(params.name) as { config: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);
    return jsonResponse({ data: JSON.parse(row.config) });
  });

  router.patch("/api/databases/:name/config", async (req, params) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    const body = await parseJsonBody<Record<string, any>>(req); if (body instanceof Response) return body;

    const unknownKeys = Object.keys(body).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return errorResponse("VALIDATION", `Unknown config keys: ${unknownKeys.join(", ")}. Allowed: ${[...ALLOWED_CONFIG_KEYS].join(", ")}`, 400);
    }

    const row = metaPool.read().query("SELECT config FROM _databases WHERE name = ?").get(params.name) as { config: string } | null;
    if (!row) return errorResponse("NOT_FOUND", "Database not found.", 404);

    const current = JSON.parse(row.config);
    const updated = { ...current, ...body };

    metaPool.write().run("UPDATE _databases SET config = ? WHERE name = ?", [JSON.stringify(updated), params.name]);
    logActivity(manager, { action: "database.config.update", admin_id: await getAdminId(req, manager), database_name: params.name, details: { from: current, to: updated, changes: body }, ip: getClientIp(req) });
    return jsonResponse({ data: updated });
  });
}
