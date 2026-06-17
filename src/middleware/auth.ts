/**
 * Authentication/authorization middleware for Boltstore.
 *
 * Extracts a Bearer JWT token or an API key secret from the incoming request,
 * verifies it against the database, and returns an auth context. Admin-only
 * routes must additionally ensure the principal has role "admin" (or a valid
 * API key with admin-scoped permissions).
 *
 * @module boltstore/middleware/auth
 */

import { DatabaseManager } from "../db/manager";
import {
  verifyAccessToken,
  type AuthConfig,
} from "../auth";
export { type AuthConfig } from "../auth";
import { verifyApiKey, type ApiKeyContext } from "../admin/api-keys";

/** Authenticated principal returned by the middleware. */
export interface AuthContext {
  /** User ID (JWT) or API key ID (API key). */
  principalId: string;
  /** Email when authenticated via JWT. */
  email?: string;
  /** Role when authenticated via JWT. */
  role?: "user" | "admin";
  /** API key context when authenticated via API key. */
  apiKey?: ApiKeyContext;
  /** True if the principal was resolved from an API key. */
  isApiKey: boolean;
}

/** Result of authentication: context on success, Response on failure. */
export type AuthResult = AuthContext | Response;

/** Extract a Bearer token or API key secret from request headers. */
function extractCredentials(request: Request): { token?: string; apiKey?: string } {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const value = auth.slice(7).trim();
    // API keys always start with "blt_"
    if (value.startsWith("blt_")) {
      return { apiKey: value };
    }
    return { token: value };
  }

  const apiKey = request.headers.get("X-API-Key") || request.headers.get("x-api-key");
  if (apiKey) return { apiKey: apiKey.trim() };

  return {};
}

/**
 * Authenticate the request against the given database.
 *
 * Returns an `AuthContext` on success or a 401/403 Response on failure.
 */
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
      const ctx = await verifyApiKey(pool, apiKey);
      return {
        principalId: ctx.keyId,
        apiKey: ctx,
        isApiKey: true,
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
    return {
      principalId: ctx.userId,
      email: ctx.email,
      role: ctx.role,
      isApiKey: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Require an authenticated admin principal.
 *
 * JWT users must have role "admin". API keys are not allowed for admin
 * routes unless the key explicitly includes the "admin" operation.
 */
export function requireAdmin(auth: AuthContext): Response | null {
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

  if (auth.role !== "admin") {
    return new Response(
      JSON.stringify({ error: { code: "FORBIDDEN", message: "Admin access required." } }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}
