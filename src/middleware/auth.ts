import { DatabaseManager } from "../db/manager";
import { verifyAccessToken, type AuthConfig } from "../auth";
export type { AuthConfig } from "../auth";
import { verifyApiKey, apiKeyAllows, type ApiKeyContext, type ApiKeyOperation } from "../admin/api-keys";

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

  // Token verification happens against the database specified in the request.
  // Each application database stores its own _users and _tokens tables.
  const authPool = database === "_system" ? manager.getMetaPool() : manager.get(database);

  if (apiKey) {
    try {
      const ctx = await verifyApiKey(authPool, apiKey);

      if (ctx.permissions.role !== "admin") {
        const allowedDbs = ctx.permissions.allowedDatabases ?? [];
        if (allowedDbs.length > 0 && !allowedDbs.includes("*") && !allowedDbs.includes(database)) {
          return new Response(
            JSON.stringify({
              error: { code: "FORBIDDEN", message: `API key does not have access to database "${database}".` },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      return {
        principalId: ctx.keyId,
        apiKey: ctx,
        isApiKey: true,
        isAdmin: ctx.permissions.role === "admin",
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
    const ctx = verifyAccessToken(authPool, token!, authConfig);

    // Determine admin status from JWT claim (avoids DB query on every request).
    let isAdmin = false;
    const payload = extractJwtPayload(token!);
    if (payload?.admin === true) {
      isAdmin = true;
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

/** Decode a JWT payload without signature verification. Used only for extracting
 *  the admin claim — do NOT trust this for authentication. */
function extractJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
}

export function requireAdmin(auth: AuthContext): Response | null {
  // API keys with admin role
  if (auth.isApiKey) {
    if (auth.apiKey?.permissions.role !== "admin") {
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
