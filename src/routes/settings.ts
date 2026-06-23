import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";

const SETTINGS_KEY = "global_settings";

const DEFAULT_SETTINGS = {
  timezone: "UTC",
};

export function registerSettingsRoutes(router: Router, manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/settings", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const row = metaPool.read().query("SELECT value FROM _meta WHERE key = ?").get(SETTINGS_KEY) as { value: string } | null;
    const settings = row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : DEFAULT_SETTINGS;
    return jsonResponse({ data: settings });
  });

  router.patch("/api/settings", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await parseJsonBody<Record<string, unknown>>(req); if (body instanceof Response) return body;

    const row = metaPool.read().query("SELECT value FROM _meta WHERE key = ?").get(SETTINGS_KEY) as { value: string } | null;
    const current = row ? JSON.parse(row.value) : {};
    const updated = { ...current, ...body };

    metaPool.write().run(
      "INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      [SETTINGS_KEY, JSON.stringify(updated), JSON.stringify(updated)]
    );
    logActivity(manager, { action: "settings.update", admin_id: await getAdminId(req, manager), details: { from: current, to: updated, changes: body }, ip: getClientIp(req) });
    return jsonResponse({ data: updated });
  });
}
