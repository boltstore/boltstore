import { DatabaseManager } from "../db/manager";
import { errorResponse } from "../server";
import { logger } from "../logger";
import { sha256Hex, timingSafeEqual } from "../crypto-utils";
import { checkApiKeyThrottle } from "./throttle";
import { getClientIp } from "../routes/activity";

export interface AuthResult {
  authenticated: boolean;
  databaseName?: string;
  keyId?: string;
  label?: string;
  isAdmin: boolean;
}

export interface AdminSession {
  adminId: string;
}

export async function resolveAdminSession(request: Request, manager?: DatabaseManager): Promise<AdminSession | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  // Check admin key from config/env (constant-time compare)
  const adminKey = Bun.env.BOLTSTORE_ADMIN_KEY;
  if (adminKey && timingSafeEqual(token, adminKey)) {
    return { adminId: "admin_key" };
  }

  // Check session token from _sessions table (lookup by hash)
  if (manager) {
    try {
      const hashHex = await sha256Hex(token);
      const row = manager.getMetaPool().read()
        .query("SELECT admin_id FROM _sessions WHERE token_hash = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))")
        .get(hashHex) as { admin_id: string } | null;
      if (row) return { adminId: row.admin_id };
    } catch (err) {
      logger.warn("Session lookup failed in isAdminRequest", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return null;
}

export async function isAdminRequest(request: Request, manager?: DatabaseManager): Promise<boolean> {
  const session = await resolveAdminSession(request, manager);
  return session !== null;
}

export async function authenticateApiKey(
  request: Request,
  manager: DatabaseManager,
  databaseName: string
): Promise<AuthResult | Response> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return errorResponse("UNAUTHORIZED", "Missing or invalid Authorization header.", 401);
  }

  const providedKey = auth.slice(7).trim();
  if (!providedKey) {
    return errorResponse("UNAUTHORIZED", "Missing API key.", 401);
  }

  // Admin check — admin key or session token can access any database
  if (await isAdminRequest(request, manager)) {
    return { authenticated: true, isAdmin: true, databaseName };
  }

  // Rate limit by IP + database to prevent brute-force
  const throttle = checkApiKeyThrottle(getClientIp(request), databaseName);
  if (!throttle.allowed) {
    return errorResponse("RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil(throttle.retryAfterMs / 1000)} seconds.`, 429);
  }

  // Look up key by database + hash in system database.
  // The hash is matched in SQL (not in JS) so that:
  //   1. multiple keys per database are handled correctly (each row is checked),
  //   2. the hash column is never SELECTed back over the wire,
  //   3. there is no JS-side string compare timing side-channel.
  const metaPool = manager.getMetaPool();
  const db = metaPool.read();
  const hashHex = await sha256Hex(providedKey);

  const row = db
    .query("SELECT id, label FROM _api_keys WHERE database_name = ? AND hash = ?")
    .get(databaseName, hashHex) as { id: string; label: string } | null;

  if (!row) {
    return errorResponse("UNAUTHORIZED", "Invalid API key.", 401);
  }

  // Update last_used_at on the write connection
  manager.getMetaPool().write().run("UPDATE _api_keys SET last_used_at = datetime('now') WHERE id = ?", [row.id]);

  return { authenticated: true, databaseName, keyId: row.id, label: row.label, isAdmin: false };
}

export function checkDbCors(request: Request, manager: DatabaseManager, databaseName: string): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  try {
    const row = manager.getMetaPool().read()
      .query("SELECT config FROM _databases WHERE name = ?")
      .get(databaseName) as { config: string } | null;
    if (!row) return null;

    const config = JSON.parse(row.config);
    const origins: string[] = config.cors_origins;

    if (!origins || origins.length === 0) return null;
    if (origins.includes("*")) return null;
    if (origins.includes(origin)) return null;

    return errorResponse("FORBIDDEN", `Origin "${origin}" is not allowed for this database.`, 403);
  } catch (err) {
    logger.warn("DB CORS check failed", { database: databaseName, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}