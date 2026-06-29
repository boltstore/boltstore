import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { authenticateApiKey } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";
import { generateToken, generateId, sha256Hex } from "../crypto-utils";
import { validateDbName } from "../validation";

const KEY_PREFIX = "boltstore_";

function generateApiKey(): string {
  return KEY_PREFIX + generateToken(32);
}

export function registerApiKeyRoutes(router: Router, manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/databases/:name/keys", async (req, params) => {
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    const auth = await authenticateApiKey(req, manager, params.name);
    if (auth instanceof Response) return auth;
    const db = metaPool.read();
    const keys = db.query("SELECT id, label, created_at, last_used_at FROM _api_keys WHERE database_name = ? ORDER BY created_at DESC").all(params.name);
    return jsonResponse({ data: keys });
  });

  router.post("/api/databases/:name/keys", async (req, params) => {
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    const auth = await authenticateApiKey(req, manager, params.name);
    if (auth instanceof Response) return auth;
    const body = await parseJsonBody<{ label?: string }>(req); if (body instanceof Response) return body;
    if (!body.label || typeof body.label !== "string" || body.label.length < 1) {
      return errorResponse("VALIDATION", "Label is required.", 400);
    }

    const key = generateApiKey();
    const hash = await sha256Hex(key);
    const id = generateId("apk_", 24);

    metaPool.write().run(
      "INSERT INTO _api_keys (id, database_name, label, hash) VALUES (?, ?, ?, ?)",
      [id, params.name, body.label, hash]
    );

    logActivity(manager, { action: "api_key.create", admin_id: await getAdminId(req, manager), database_name: params.name, target: body.label, ip: getClientIp(req) });
    return jsonResponse({ data: { id, label: body.label, key } }, 201);
  });

  router.post("/api/databases/:name/keys/:keyId/rotate", async (req, params) => {
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    const auth = await authenticateApiKey(req, manager, params.name);
    if (auth instanceof Response) return auth;
    const key = generateApiKey();
    const hash = await sha256Hex(key);

    const existing = metaPool.read().query("SELECT label FROM _api_keys WHERE id = ? AND database_name = ?").get(params.keyId, params.name) as { label: string } | null;
    if (!existing) return errorResponse("NOT_FOUND", "API key not found.", 404);

    metaPool.write().run(
      "UPDATE _api_keys SET hash = ? WHERE id = ? AND database_name = ?",
      [hash, params.keyId, params.name]
    );

    logActivity(manager, { action: "api_key.rotate", admin_id: await getAdminId(req, manager), database_name: params.name, target: params.keyId, details: { label: existing.label }, ip: getClientIp(req) });
    return jsonResponse({ data: { id: params.keyId, key } });
  });

  router.delete("/api/databases/:name/keys/:keyId", async (req, params) => {
    const nameErr = validateDbName(params.name);
    if (nameErr) return nameErr;
    const auth = await authenticateApiKey(req, manager, params.name);
    if (auth instanceof Response) return auth;
    const result = metaPool.write().run(
      "DELETE FROM _api_keys WHERE id = ? AND database_name = ?",
      [params.keyId, params.name]
    );
    if (result.changes === 0) return errorResponse("NOT_FOUND", "API key not found.", 404);
    logActivity(manager, { action: "api_key.revoke", admin_id: await getAdminId(req, manager), database_name: params.name, target: params.keyId, ip: getClientIp(req) });
    return jsonResponse({ data: { revoked: true } });
  });
}