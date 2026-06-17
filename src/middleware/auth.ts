import { DatabaseManager } from "../db/manager";
import {
  verifyAccessToken,
  type AuthConfig,
} from "../auth";
export { type AuthConfig } from "../auth";
import { verifyApiKey, type ApiKeyContext } from "../admin/api-keys";

export interface AuthContext {
  principalId: string;
  email?: string;
  apiKey?: ApiKeyContext;
  isApiKey: boolean;
  isAdmin: boolean;
}

export type AuthResult = AuthContext | Response;

function extractCredentials(request: Request): { token?: string; apiKey?: string } {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const value = auth.slice(7).trim();
    if (value.startsWith("blt_")) {
      return { apiKey: value };
    }
    return { token: value };
  }

  const apiKey = request.headers.get("X-API-Key") || request.headers.get("x-api-key");
  if (apiKey) return { apiKey: apiKey.trim() };

  return {};
}

export async function authenticateRequest(
  request: Request,
  manager: DatabaseManager,
  database: string,
  authConfig: AuthConfig
): Promise<AuthResult> {
  const { token, apiKey } = extractCredentials(request);

  if (!token && !apiKey) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Authentication required." } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const pool = database === "_system" ? manager.getMetaPool() : manager.get(database);

  if (apiKey) {
    try {
      // Admin API keys are always stored in the system meta database
      const ctx = await verifyApiKey(manager.getMetaPool(), apiKey);
      return {
        principalId: ctx.keyId,
        apiKey: ctx,
        isApiKey: true,
        isAdmin: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid API key";
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  try {
    const ctx = verifyAccessToken(pool, token!, authConfig);

    // Check if this user exists in the system database — system users are admins
    let isAdmin = false;
    try {
      const metaDb = manager.getMetaPool().read();
      const sysUser = metaDb
        .query("SELECT 1 FROM _users WHERE id=?")
        .get(ctx.userId);
      if (sysUser) isAdmin = true;
    } catch {
      // Meta pool might not be available — not admin
    }

    return {
      principalId: ctx.userId,
      email: ctx.email,
      isApiKey: false,
      isAdmin,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
}

export function requireAdmin(auth: AuthContext): Response | null {
  // API keys with admin scope
  if (auth.isApiKey) {
    const ops = auth.apiKey?.permissions.operations ?? [];
    if (!ops.includes("admin")) {
      return new Response(
        JSON.stringify({ error: { code: "FORBIDDEN", message: "Admin access required." } }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    return null;
  }

  // JWT users that exist in the system database are admins
  if (auth.isAdmin) {
    return null;
  }

  return new Response(
    JSON.stringify({ error: { code: "FORBIDDEN", message: "Admin access required." } }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}
