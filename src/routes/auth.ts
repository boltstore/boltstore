/**
 * Authentication routes for Boltstore.
 *
 * @module boltstore/routes/auth
 */

import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  getUserById,
  updateProfile,
  verifyAccessToken,
  type AuthConfig,
} from "../auth";
import { jsonResponse, errorResponse } from "../server";

/** Extract Bearer token from Authorization header. */
function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/** Verify token and return user context, or return a 401 response. */
function requireAuth(
  pool: ReturnType<DatabaseManager["get"]>,
  token: string | null,
  config: AuthConfig
): { userId: string; email: string; role: "user" | "admin" } | Response {
  if (!token) {
    return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  }
  try {
    return verifyAccessToken(pool, token, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    const status = (err as { status?: number }).status || 401;
    return errorResponse("UNAUTHORIZED", message, status);
  }
}

export function registerAuthRoutes(
  router: Router,
  manager: DatabaseManager,
  config: AuthConfig
): void {
  // POST /api/:database/auth/register — register a new user
  router.post("/api/:database/auth/register", async (req, params) => {
    try {
      const { email, password } = await req.json();
      if (!email || typeof email !== "string") return errorResponse("VALIDATION", "Field 'email' is required.", 400);
      if (!password || typeof password !== "string") return errorResponse("VALIDATION", "Field 'password' is required.", 400);
      const pool = manager.get(params.database);
      const user = await registerUser(pool, email, password);
      return jsonResponse({ data: user }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      return errorResponse("REGISTER_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // POST /api/:database/auth/login — authenticate and get tokens
  router.post("/api/:database/auth/login", async (req, params) => {
    try {
      const { email, password } = await req.json();
      if (!email || typeof email !== "string") return errorResponse("VALIDATION", "Field 'email' is required.", 400);
      if (!password || typeof password !== "string") return errorResponse("VALIDATION", "Field 'password' is required.", 400);
      const pool = manager.get(params.database);
      const tokens = await loginUser(pool, email, password, config);
      return jsonResponse({ data: tokens });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      return errorResponse("LOGIN_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // POST /api/:database/auth/refresh — refresh access token
  router.post("/api/:database/auth/refresh", async (req, params) => {
    try {
      const { refreshToken } = await req.json();
      if (!refreshToken || typeof refreshToken !== "string") return errorResponse("VALIDATION", "Field 'refreshToken' is required.", 400);
      const pool = manager.get(params.database);
      const tokens = await refreshAccessToken(pool, refreshToken, config);
      return jsonResponse({ data: tokens });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token refresh failed";
      return errorResponse("REFRESH_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // POST /api/:database/auth/logout — logout (requires auth)
  router.post("/api/:database/auth/logout", (req, params) => {
    try {
      const token = extractBearerToken(req);
      const pool = manager.get(params.database);
      const auth = requireAuth(pool, token, config);
      if (auth instanceof Response) return auth;
      logoutUser(pool, auth.userId);
      return jsonResponse({ data: { loggedOut: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Logout failed";
      return errorResponse("LOGOUT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // GET /api/:database/auth/me — get current user (requires auth)
  router.get("/api/:database/auth/me", (req, params) => {
    try {
      const token = extractBearerToken(req);
      const pool = manager.get(params.database);
      const auth = requireAuth(pool, token, config);
      if (auth instanceof Response) return auth;
      const user = getUserById(pool, auth.userId);
      return jsonResponse({ data: user });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get user";
      return errorResponse("ME_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // PATCH /api/:database/auth/me — update profile (requires auth)
  router.patch("/api/:database/auth/me", async (req, params) => {
    try {
      const token = extractBearerToken(req);
      const pool = manager.get(params.database);
      const auth = requireAuth(pool, token, config);
      if (auth instanceof Response) return auth;
      const { email, password } = await req.json();
      const user = await updateProfile(pool, auth.userId, { email, password });
      return jsonResponse({ data: user });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update profile";
      return errorResponse("UPDATE_ME_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}