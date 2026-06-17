/**
 * Authentication routes for Boltstore.
 *
 * @module boltstore/routes/auth
 */

import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { registerUser, loginUser, refreshAccessToken, logoutUser, getUserById, updateProfile, type AuthConfig } from "../auth";
import { jsonResponse, errorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest } from "../middleware/auth";

export function registerAuthRoutes(
  router: Router,
  manager: DatabaseManager,
  config: AuthConfig
): void {
  const audit = (req: Request, type: "auth.register" | "auth.login" | "auth.refresh" | "auth.logout" | "auth.profile_update" | "auth.password_change", success: boolean, database?: string, principalId?: string, details?: Record<string, unknown>, error?: string) => {
    logAuditEvent(auditFromRequest(req, {
      type,
      principalId,
      principalType: "user",
      database,
      action: type.split(".")[1],
      success,
      details,
      error,
    }));
  };

  // POST /api/:database/auth/register — register a new user
  router.post("/api/:database/auth/register", async (req, params) => {
    try {
      const { email, password } = await req.json();
      if (!email || typeof email !== "string") return errorResponse("VALIDATION", "Field 'email' is required.", 400);
      if (!password || typeof password !== "string") return errorResponse("VALIDATION", "Field 'password' is required.", 400);
      const pool = manager.get(params.database);
      const user = await registerUser(pool, email, password);
      audit(req, "auth.register", true, params.database, user.id, { email });
      return jsonResponse({ data: user }, 201);
    } catch (err) {
      audit(req, "auth.register", false, params.database, undefined, undefined, err instanceof Error ? err.message : "Registration failed");
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
      audit(req, "auth.login", true, params.database, tokens.userId, { email });
      return jsonResponse({ data: tokens });
    } catch (err) {
      audit(req, "auth.login", false, params.database, undefined, undefined, err instanceof Error ? err.message : "Login failed");
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
      audit(req, "auth.refresh", true, params.database, tokens.userId);
      return jsonResponse({ data: tokens });
    } catch (err) {
      audit(req, "auth.refresh", false, params.database, undefined, undefined, err instanceof Error ? err.message : "Token refresh failed");
      const message = err instanceof Error ? err.message : "Token refresh failed";
      return errorResponse("REFRESH_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // POST /api/:database/auth/logout — logout (requires auth)
  router.post("/api/:database/auth/logout", async (req, params) => {
    try {
      const authCtx = await authenticateRequest(req, manager, params.database, config);
      if (authCtx instanceof Response) return authCtx;
      logoutUser(manager.get(params.database), authCtx.principalId);
      audit(req, "auth.logout", true, params.database, authCtx.principalId);
      return jsonResponse({ data: { loggedOut: true } });
    } catch (err) {
      audit(req, "auth.logout", false, params.database, undefined, undefined, err instanceof Error ? err.message : "Logout failed");
      const message = err instanceof Error ? err.message : "Logout failed";
      return errorResponse("LOGOUT_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // GET /api/:database/auth/me — get current user (requires auth)
  router.get("/api/:database/auth/me", async (req, params) => {
    try {
      const authCtx = await authenticateRequest(req, manager, params.database, config);
      if (authCtx instanceof Response) return authCtx;
      const pool = manager.get(params.database);
      const user = getUserById(pool, authCtx.principalId);
      return jsonResponse({ data: user });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get user";
      return errorResponse("ME_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  // PATCH /api/:database/auth/me — update profile (requires auth)
  router.patch("/api/:database/auth/me", async (req, params) => {
    try {
      const authCtx = await authenticateRequest(req, manager, params.database, config);
      if (authCtx instanceof Response) return authCtx;
      const { email, password } = await req.json();
      const user = await updateProfile(manager.get(params.database), authCtx.principalId, { email, password });
      const type: "auth.profile_update" | "auth.password_change" = password ? "auth.password_change" : "auth.profile_update";
      audit(req, type, true, params.database, authCtx.principalId, { emailChanged: !!email, passwordChanged: !!password });
      return jsonResponse({ data: user });
    } catch (err) {
      audit(req, "auth.profile_update", false, params.database, undefined, undefined, err instanceof Error ? err.message : "Failed to update profile");
      const message = err instanceof Error ? err.message : "Failed to update profile";
      return errorResponse("UPDATE_ME_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}
