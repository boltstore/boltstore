import { DatabaseManager } from "../db/manager";
import { errorResponse } from "../server";

export interface AuthResult {
  authenticated: boolean;
  databaseName?: string;
  keyId?: string;
  label?: string;
  isAdmin: boolean;
}

export function isAdminRequest(request: Request, manager?: DatabaseManager): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;

  // Check admin key from config/env
  if (Bun.env.BOLTSTORE_ADMIN_KEY && token === Bun.env.BOLTSTORE_ADMIN_KEY) return true;

  // Check session token from _sessions table
  if (manager) {
    try {
      const row = manager.getMetaPool().read()
        .query("SELECT 1 FROM _sessions WHERE token = ?")
        .get(token);
      if (row) return true;
    } catch {}
  }

  return false;
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
  if (isAdminRequest(request, manager)) {
    return { authenticated: true, isAdmin: true, databaseName };
  }

  // Look up key hash in system database
  const metaPool = manager.getMetaPool();
  const db = metaPool.read();
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(providedKey));
  const hashHex = Array.from(new Uint8Array(hashed)).map(b => b.toString(16).padStart(2, "0")).join("");

  const row = db
    .query("SELECT id, label, hash FROM _api_keys WHERE database_name = ?")
    .get(databaseName) as { id: string; label: string; hash: string } | null;

  if (!row || row.hash !== hashHex) {
    return errorResponse("UNAUTHORIZED", "Invalid API key.", 401);
  }

  // Update last_used_at
  db.run("UPDATE _api_keys SET last_used_at = datetime('now') WHERE id = ?", [row.id]);

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
  } catch {
    return null;
  }
}
