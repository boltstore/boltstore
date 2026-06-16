/**
 * OAuth2 authentication module for Boltstore.
 *
 * Supports Google and GitHub OAuth2 login. No third-party libraries —
 * uses built-in `fetch` for token exchange and profile retrieval.
 *
 * OAuth users are stored in the same `_users` table as password users.
 * Email-matching links OAuth and password accounts.
 *
 * @module boltstore/admin/oauth
 */

import { DatabasePool } from "../db/pool";
import { loginUser, type AuthConfig, type TokenPair, type User, bootstrapAuthTables, hashPassword } from "../auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthConfig {
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
}

/** Standardized user info returned by any OAuth provider. */
interface OAuthProfile {
  id: string;
  email: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_SCOPES = "openid email profile";

async function googleExchangeCode(
  code: string,
  redirectUri: string,
  config: OAuthProviderConfig
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw Object.assign(
      new Error(`Google token exchange failed: ${response.status} ${errorText}`),
      { status: 401 }
    );
  }

  const data = await response.json();
  return data.access_token as string;
}

async function googleFetchProfile(accessToken: string): Promise<OAuthProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw Object.assign(
      new Error(`Google profile fetch failed: ${response.status}`),
      { status: 401 }
    );
  }

  const data = await response.json();
  return {
    id: data.sub,
    email: data.email,
    name: data.name,
  };
}

// ---------------------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------------------

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const GITHUB_SCOPES = "user:email";

async function githubExchangeCode(
  code: string,
  redirectUri: string,
  config: OAuthProviderConfig
): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw Object.assign(
      new Error(`GitHub token exchange failed: ${response.status} ${errorText}`),
      { status: 401 }
    );
  }

  const data = await response.json();
  return data.access_token as string;
}

async function githubFetchProfile(accessToken: string): Promise<OAuthProfile> {
  // Fetch user info
  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "Boltstore",
    },
  });

  if (!userResponse.ok) {
    throw Object.assign(
      new Error(`GitHub profile fetch failed: ${userResponse.status}`),
      { status: 401 }
    );
  }

  const userData = await userResponse.json();

  // If email is not public, fetch from /user/emails
  let email = userData.email as string | null;
  if (!email) {
    const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Boltstore",
      },
    });

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as { email: string; primary: boolean; verified: boolean }[];
      const primary = emails.find((e) => e.primary && e.verified);
      if (primary) email = primary.email;
    }
  }

  if (!email) {
    throw Object.assign(
      new Error("Could not find a verified email for this GitHub account."),
      { status: 400 }
    );
  }

  return {
    id: String(userData.id),
    email,
    name: userData.name || userData.login,
  };
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

type ProviderHandler = {
  name: string;
  scopes: string;
  getAuthUrl(redirectUri: string, config: OAuthProviderConfig): string;
  exchangeCode(code: string, redirectUri: string, config: OAuthProviderConfig): Promise<string>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
};

function getProviders(): Map<string, ProviderHandler> {
  const providers = new Map<string, ProviderHandler>();

  const googleConfig = {
    clientId: Bun.env.GOOGLE_CLIENT_ID,
    clientSecret: Bun.env.GOOGLE_CLIENT_SECRET,
  };

  if (googleConfig.clientId && googleConfig.clientSecret) {
    providers.set("google", {
      name: "google",
      scopes: GOOGLE_SCOPES,
      getAuthUrl(redirectUri, config) {
        const params = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
        });
        return `${GOOGLE_AUTH_URL}?${params}`;
      },
      exchangeCode: googleExchangeCode,
      fetchProfile: googleFetchProfile,
    });
  }

  const githubConfig = {
    clientId: Bun.env.GITHUB_CLIENT_ID,
    clientSecret: Bun.env.GITHUB_CLIENT_SECRET,
  };

  if (githubConfig.clientId && githubConfig.clientSecret) {
    providers.set("github", {
      name: "github",
      scopes: GITHUB_SCOPES,
      getAuthUrl(redirectUri, config) {
        const params = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          scope: GITHUB_SCOPES,
        });
        return `${GITHUB_AUTH_URL}?${params}`;
      },
      exchangeCode: githubExchangeCode,
      fetchProfile: githubFetchProfile,
    });
  }

  return providers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the authorization URL for a provider.
 *
 * `GET /api/:database/auth/oauth/:provider/url?redirect_uri=...`
 */
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

  // Get provider-specific config (clientId from env)
  const providerConfig = getProviderEnvConfig(provider);
  return handler.getAuthUrl(redirectUri, providerConfig);
}

/**
 * Authenticate via OAuth: exchange code, fetch profile, find/create user, return tokens.
 *
 * `POST /api/:database/auth/oauth/:provider`
 */
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

  // Get provider config
  const providerConfig = getProviderEnvConfig(provider);

  // Exchange code for access token
  const accessToken = await handler.exchangeCode(code, redirectUri, providerConfig);

  // Fetch user profile
  const profile = await handler.fetchProfile(accessToken);

  // Find or create user
  const user = await findOrCreateOAuthUser(pool, profile);

  // Issue JWT tokens
  return loginUser(pool, user.email, user.id, authConfig);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProviderEnvConfig(provider: string): OAuthProviderConfig {
  const lower = provider.toLowerCase();
  if (lower === "google") {
    if (!Bun.env.GOOGLE_CLIENT_ID || !Bun.env.GOOGLE_CLIENT_SECRET) {
      throw Object.assign(
        new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."),
        { status: 500 }
      );
    }
    return { clientId: Bun.env.GOOGLE_CLIENT_ID, clientSecret: Bun.env.GOOGLE_CLIENT_SECRET };
  }

  if (lower === "github") {
    if (!Bun.env.GITHUB_CLIENT_ID || !Bun.env.GITHUB_CLIENT_SECRET) {
      throw Object.assign(
        new Error("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."),
        { status: 500 }
      );
    }
    return { clientId: Bun.env.GITHUB_CLIENT_ID, clientSecret: Bun.env.GITHUB_CLIENT_SECRET };
  }

  throw Object.assign(
    new Error(`Unknown provider: ${provider}`),
    { status: 400 }
  );
}

/**
 * Find an existing user by email, or create a new OAuth user.
 * OAuth users have a random auto-generated password (they can set one later).
 */
async function findOrCreateOAuthUser(
  pool: DatabasePool,
  profile: OAuthProfile
): Promise<User> {
  bootstrapAuthTables(pool);
  const db = pool.read();

  // Check if user already exists by email
  const existing = db
    .query("SELECT id, email, role, created_at, updated_at FROM _users WHERE email=?")
    .get(profile.email) as User | null;

  if (existing) {
    return existing;
  }

  // Create new user with auto-generated password
  const id = `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const ts = new Date().toISOString();
  const randomPassword = await hashPassword(id); // Use user ID as random password

  return pool.writeTransaction(() => {
    const writeDb = pool.write();
    writeDb.run(
      "INSERT INTO _users (id, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, profile.email, randomPassword, "user", ts, ts]
    );

    return { id, email: profile.email, role: "user" as const, created_at: ts, updated_at: ts };
  });
}