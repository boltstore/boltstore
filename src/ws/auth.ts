import { DatabaseManager } from "../db/manager";
import { verifyAccessToken, type AuthConfig } from "../auth";
import { verifyApiKey } from "../admin/api-keys";

export interface WsAuthResult {
  userId?: string;
  email?: string;
  isAdmin: boolean;
  database?: string;
}

export async function authenticateWsUpgrade(
  url: URL,
  manager: DatabaseManager | undefined,
  authConfig: AuthConfig
): Promise<WsAuthResult | Response> {
  const token = url.searchParams.get("token");
  const database = url.searchParams.get("database") || url.searchParams.get("db") || undefined;

  if (!token) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Authentication required. Provide ?token= query parameter." } }),
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
        isAdmin: (ctx.permissions.operations ?? []).includes("admin"),
        database,
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
