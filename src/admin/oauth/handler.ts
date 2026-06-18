import { DatabasePool } from "../../db/pool";
import { createTokenPairForUser, type AuthConfig, type TokenPair } from "../../auth";
import { getProviders, getProviderEnvConfig } from "./registry";
import { findOrCreateOAuthUser } from "./user";

export function getAuthorizationUrl(
  provider: string,
  redirectUri: string
): string {
  const providers = getProviders();
  const handler = providers.get(provider.toLowerCase());

  if (!handler) {
    throw Object.assign(
      new Error(`OAuth provider "${provider}" is not configured. Supported: ${[...providers.keys()].join(", ") || "none"}`),
      { status: 400 }
    );
  }

  if (!redirectUri || typeof redirectUri !== "string") {
    throw Object.assign(
      new Error("Query parameter 'redirect_uri' is required."),
      { status: 400 }
    );
  }

  const providerConfig = getProviderEnvConfig(provider);
  return handler.getAuthUrl(redirectUri, providerConfig);
}

export async function authenticateWithOAuth(
  pool: DatabasePool,
  provider: string,
  code: string,
  redirectUri: string,
  authConfig: AuthConfig
): Promise<TokenPair> {
  const providers = getProviders();
  const handler = providers.get(provider.toLowerCase());

  if (!handler) {
    throw Object.assign(
      new Error(`OAuth provider "${provider}" is not configured.`),
      { status: 400 }
    );
  }

  if (!code || typeof code !== "string") {
    throw Object.assign(
      new Error("Field 'code' is required."),
      { status: 400 }
    );
  }

  if (!redirectUri || typeof redirectUri !== "string") {
    throw Object.assign(
      new Error("Field 'redirect_uri' is required."),
      { status: 400 }
    );
  }

  const providerConfig = getProviderEnvConfig(provider);

  const accessToken = await handler.exchangeCode(code, redirectUri, providerConfig);

  const profile = await handler.fetchProfile(accessToken);

  const user = await findOrCreateOAuthUser(pool, profile);

  if (user.oauth_only === 1 && !user.password_set) {
    throw Object.assign(
      new Error("OAuth account requires a password reset before first login. Use PATCH /api/:database/auth/me to set a password."),
      { status: 403, code: "OAUTH_PASSWORD_RESET_REQUIRED" }
    );
  }

  return createTokenPairForUser(pool, user, authConfig);
}
