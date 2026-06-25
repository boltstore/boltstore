import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";

const SETTINGS_KEY = "global_settings";

const DEFAULT_SETTINGS = {
  timezone: "UTC",
};

const ALLOWED_SETTINGS_KEYS = new Set(["timezone", "server_url"]);

export function registerSettingsRoutes(router: Router, manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/settings", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const row = metaPool.read().query("SELECT value FROM _meta WHERE key = ?").get(SETTINGS_KEY) as { value: string } | null;
    const settings: Record<string, unknown> = row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : { ...DEFAULT_SETTINGS };

    const host = new URL(req.url).host;
    settings.resolved_server_url = settings.server_url && typeof settings.server_url === "string" && settings.server_url.trim()
      ? settings.server_url.trim()
      : `http://${host}`;

    return jsonResponse({ data: settings });
  });

  router.patch("/api/settings", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await parseJsonBody<Record<string, unknown>>(req); if (body instanceof Response) return body;

    const unknownKeys = Object.keys(body).filter(k => !ALLOWED_SETTINGS_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return errorResponse("VALIDATION", `Unknown settings keys: ${unknownKeys.join(", ")}. Allowed: ${[...ALLOWED_SETTINGS_KEYS].join(", ")}`, 400);
    }

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
