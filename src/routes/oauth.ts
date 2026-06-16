import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { getAuthorizationUrl, authenticateWithOAuth } from "../admin/oauth";
import { type AuthConfig } from "../auth";
import { jsonResponse, errorResponse } from "../server";

export function registerOAuthRoutes(
  router: Router,
  manager: DatabaseManager,
  config: AuthConfig
): void {
  router.get("/api/:database/auth/oauth/:provider/url", (req, params) => {
    try {
      const url = new URL(req.url);
      const redirectUri = url.searchParams.get("redirect_uri");
      if (!redirectUri) return errorResponse("VALIDATION", "Query parameter 'redirect_uri' is required.", 400);
      const authUrl = getAuthorizationUrl(params.provider, redirectUri);
      return jsonResponse({ data: { url: authUrl } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get authorization URL";
      return errorResponse("OAUTH_URL_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/:database/auth/oauth/:provider", async (req, params) => {
    try {
      const { code, redirect_uri } = await req.json();
      if (!code || typeof code !== "string") return errorResponse("VALIDATION", "Field 'code' is required.", 400);
      if (!redirect_uri || typeof redirect_uri !== "string") return errorResponse("VALIDATION", "Field 'redirect_uri' is required.", 400);
      const pool = manager.get(params.database);
      const tokens = await authenticateWithOAuth(pool, params.provider, code, redirect_uri, config);
      return jsonResponse({ data: tokens });
    } catch (err) {
      const message = err instanceof Error ? err.message : "OAuth authentication failed";
      return errorResponse("OAUTH_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}