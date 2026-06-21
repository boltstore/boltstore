import { DatabaseManager } from "../db/manager";
import { errorResponse } from "../server";

const ADMIN_KEY_ENV = "BOLTSTORE_ADMIN_KEY";

export interface AuthResult {
  authenticated: boolean;
  databaseName?: string;
  keyId?: string;
  label?: string;
  isAdmin: boolean;
}

export function isAdminRequest(request: Request): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const key = auth.slice(7).trim();
  const adminKey = Bun.env[ADMIN_KEY_ENV];
  return !!adminKey && key === adminKey;
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

  // Admin key check
  const adminKey = Bun.env[ADMIN_KEY_ENV];
  if (adminKey && providedKey === adminKey) {
    return { authenticated: true, isAdmin: true };
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
