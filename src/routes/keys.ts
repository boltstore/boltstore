import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";
import { logActivity, getClientIp, getAdminId } from "./activity";

const KEY_PREFIX = "boltstore_";

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[bytes[i] % chars.length];
  }
  return KEY_PREFIX + key;
}

async function hashKey(key: string): Promise<string> {
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(hashed)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function registerApiKeyRoutes(router: Router, manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/databases/:name/keys", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const db = metaPool.read();
    const keys = db.query("SELECT id, label, created_at, last_used_at FROM _api_keys WHERE database_name = ? ORDER BY created_at DESC").all(params.name);
    return jsonResponse({ data: keys });
  });

  router.post("/api/databases/:name/keys", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const body = await req.json() as { label?: string };
    if (!body.label || typeof body.label !== "string" || body.label.length < 1) {
      return errorResponse("VALIDATION", "Label is required.", 400);
    }

    const key = generateApiKey();
    const hash = await hashKey(key);
    const id = "apk_" + generateSecureId(24);

    metaPool.write().run(
      "INSERT INTO _api_keys (id, database_name, label, hash) VALUES (?, ?, ?, ?)",
      [id, params.name, body.label, hash]
    );

    logActivity(manager, { action: "api_key.create", admin_id: getAdminId(req, manager), database_name: params.name, target: body.label, ip: getClientIp(req) });
    return jsonResponse({ data: { id, label: body.label, key } }, 201);
  });

  router.post("/api/databases/:name/keys/:keyId/rotate", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const key = generateApiKey();
    const hash = await hashKey(key);

    const result = metaPool.write().run(
      "UPDATE _api_keys SET hash = ? WHERE id = ? AND database_name = ?",
      [hash, params.keyId, params.name]
    );
    if (result.changes === 0) return errorResponse("NOT_FOUND", "API key not found.", 404);

    logActivity(manager, { action: "api_key.rotate", admin_id: getAdminId(req, manager), database_name: params.name, target: params.keyId, ip: getClientIp(req) });
    return jsonResponse({ data: { id: params.keyId, key } });
  });

  router.delete("/api/databases/:name/keys/:keyId", async (req, params) => {
    if (!isAdminRequest(req, manager)) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const result = metaPool.write().run(
      "DELETE FROM _api_keys WHERE id = ? AND database_name = ?",
      [params.keyId, params.name]
    );
    if (result.changes === 0) return errorResponse("NOT_FOUND", "API key not found.", 404);
    logActivity(manager, { action: "api_key.revoke", admin_id: getAdminId(req, manager), database_name: params.name, target: params.keyId, ip: getClientIp(req) });
    return jsonResponse({ data: { revoked: true } });
  });
}

function generateSecureId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}
