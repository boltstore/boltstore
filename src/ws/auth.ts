import { DatabaseManager } from "../db/manager";
import { verifyAccessToken, type AuthConfig } from "../auth";
import { verifyApiKey, type ApiKeyContext } from "../admin/api-keys";
import type { ApiKeyConnectionContext } from "./types";

export interface WsAuthResult {
  userId?: string;
  email?: string;
  isAdmin: boolean;
  database?: string;
  apiKey?: ApiKeyConnectionContext;
}

function buildApiKeyConnectionContext(ctx: ApiKeyContext): ApiKeyConnectionContext {
  return {
    keyId: ctx.keyId,
    permissions: ctx.permissions,
  };
}

export async function authenticateWsUpgrade(
  url: URL,
  manager: DatabaseManager | undefined,
  authConfig: AuthConfig,
  request?: Request
): Promise<WsAuthResult | Response> {
  let token = url.searchParams.get("token");
  const database = url.searchParams.get("db") || undefined;

  if (!token && request) {
    const auth = request.headers.get("Authorization");
    if (auth?.startsWith("Bearer ")) {
      token = auth.slice(7).trim();
    }
    if (!token) {
      token = request.headers.get("X-API-Key") || request.headers.get("x-api-key");
    }
  }

  if (!token) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Authentication required. Provide ?token=, Authorization header, or X-API-Key header." } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!manager) {
    return { isAdmin: false };
  }

  if (token.startsWith("blt_")) {
    try {
      const ctx = await verifyApiKey(manager.getMetaPool(), token);
      return {
        userId: ctx.keyId,
        isAdmin: ctx.permissions.role === "admin",
        database,
        apiKey: buildApiKeyConnectionContext(ctx),
      };
    } catch {
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid API key." } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  try {
    const pool = database ? manager.get(database) : manager.getMetaPool();
    const ctx = verifyAccessToken(pool, token, authConfig);

    let isAdmin = false;
    try {
      const metaDb = manager.getMetaPool().read();
      const sysUser = metaDb.query("SELECT 1 FROM _users WHERE id=?").get(ctx.userId);
      if (sysUser) isAdmin = true;
    } catch {
      // not admin
    }

    return {
      userId: ctx.userId,
      email: ctx.email,
      isAdmin,
      database,
    };
  } catch {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token." } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
}
