import { DatabasePool } from "../db/pool";
import type { AuthConfig, TokenPair } from "./types";
import { bootstrapAuthTables } from "./tables";
import { signJwt, verifyJwt, unixNow, now, generateJti } from "./jwt";
import { validateEmail } from "./validation";
import { verifyPassword } from "./password";

const DEFAULT_ACCESS_EXPIRY = 900;
const DEFAULT_REFRESH_EXPIRY = 604800;

export function createTokenPairForUser(
  pool: DatabasePool,
  user: { id: string; email: string },
  config: AuthConfig,
  isAdmin = false
): TokenPair {
  if (!config.secret) {
    throw Object.assign(
      new Error("JWT secret is not configured."),
      { status: 500 }
    );
  }

  bootstrapAuthTables(pool);

  const accessExpiry = config.accessTokenExpiry ?? DEFAULT_ACCESS_EXPIRY;
  const refreshExpiry = config.refreshTokenExpiry ?? DEFAULT_REFRESH_EXPIRY;
  const nowSec = unixNow();

  const accessJti = generateJti();
  const accessPayload: Record<string, unknown> = {
    sub: user.id,
    email: user.email,
    type: "access",
    jti: accessJti,
    admin: isAdmin,
    iat: nowSec,
    exp: nowSec + accessExpiry,
  };
  const accessToken = signJwt(accessPayload, config.secret, user.email.split("@")[1] || "boltstore");

  const refreshJti = generateJti();
  const refreshPayload: Record<string, unknown> = {
    sub: user.id,
    type: "refresh",
    jti: refreshJti,
    iat: nowSec,
    exp: nowSec + refreshExpiry,
  };
  const refreshToken = signJwt(refreshPayload, config.secret, user.email.split("@")[1] || "boltstore");

  pool.writeTransaction(() => {
    const writeDb = pool.write();
    writeDb.run(
      "INSERT INTO _tokens (jti, user_id, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      [accessJti, user.id, "access", new Date((nowSec + accessExpiry) * 1000).toISOString(), now()]
    );
    writeDb.run(
      "INSERT INTO _tokens (jti, user_id, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      [refreshJti, user.id, "refresh", new Date((nowSec + refreshExpiry) * 1000).toISOString(), now()]
    );
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: accessExpiry,
    userId: user.id,
    email: user.email,
  };
}

export async function loginUser(
  pool: DatabasePool,
  email: string,
  password: string,
  config: AuthConfig,
  isAdmin = false
): Promise<TokenPair> {
  // Validate email format silently; format-only validation during login
  // should not leak whether the email or password was the cause of failure.
  validateEmail(email);

  // Do NOT use validatePassword here — that leaks the minimum length policy.
  // Instead, any invalid credential combination returns the same generic 401.
  if (!password || password.length < 8) {
    throw Object.assign(
      new Error("Invalid email or password."),
      { status: 401 }
    );
  }

  if (!config.secret) {
    throw Object.assign(
      new Error("JWT secret is not configured. Set JWT_SECRET environment variable."),
      { status: 500 }
    );
  }

  bootstrapAuthTables(pool);

  const db = pool.read();
  const row = db
    .query("SELECT id, email, password_hash, oauth_only FROM _users WHERE email=?")
    .get(email.toLowerCase()) as { id: string; email: string; password_hash: string; oauth_only: number } | null;

  if (!row) {
    throw Object.assign(
      new Error("Invalid email or password."),
      { status: 401 }
    );
  }

  if (row.oauth_only === 1) {
    throw Object.assign(
      new Error("Password login is disabled for this account until a password is set via profile update."),
      { status: 403 }
    );
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    throw Object.assign(
      new Error("Invalid email or password."),
      { status: 401 }
    );
  }

  return createTokenPairForUser(pool, { id: row.id, email: row.email }, config, isAdmin);
}

export async function refreshAccessToken(
  pool: DatabasePool,
  refreshToken: string,
  config: AuthConfig,
  isAdmin = false
): Promise<TokenPair> {
  if (!config.secret) {
    throw Object.assign(
      new Error("JWT secret is not configured."),
      { status: 500 }
    );
  }

  const payload = verifyJwt(refreshToken, config.secret);
  if (payload.type !== "refresh") {
    throw Object.assign(
      new Error("Invalid token type. Expected a refresh token."),
      { status: 401 }
    );
  }

  bootstrapAuthTables(pool);
  const db = pool.read();
  const tokenRow = db
    .query("SELECT revoked FROM _tokens WHERE jti=?")
    .get(payload.jti) as { revoked: number } | null;

  if (!tokenRow || tokenRow.revoked) {
    throw Object.assign(
      new Error("Token has been revoked or is invalid."),
      { status: 401 }
    );
  }

  const userRow = db
    .query("SELECT id, email FROM _users WHERE id=?")
    .get(payload.sub) as { id: string; email: string } | null;

  if (!userRow) {
    throw Object.assign(
      new Error("User no longer exists."),
      { status: 401 }
    );
  }

  pool.write().run("UPDATE _tokens SET revoked=1 WHERE jti=?", [payload.jti]);

  return createTokenPairForUser(pool, userRow, config, isAdmin);
}

export function logoutUser(pool: DatabasePool, userId: string): void {
  bootstrapAuthTables(pool);
  pool.write().run("DELETE FROM _tokens WHERE user_id=?", [userId]);
}

export function verifyAccessToken(
  pool: DatabasePool,
  token: string,
  config: AuthConfig
): { userId: string; email: string } {
  if (!config.secret) {
    throw Object.assign(
      new Error("JWT secret is not configured."),
      { status: 500 }
    );
  }

  const payload = verifyJwt(token, config.secret);

  if (payload.type && payload.type !== "access") {
    throw Object.assign(
      new Error("Invalid token type."),
      { status: 401 }
    );
  }

  if (payload.iss !== "boltstore") {
    throw Object.assign(
      new Error("Invalid token issuer."),
      { status: 401 }
    );
  }

  bootstrapAuthTables(pool);
  const db = pool.read();
  const tokenRow = db
    .query("SELECT revoked FROM _tokens WHERE jti=?")
    .get(payload.jti) as { revoked: number } | null;

  if (!tokenRow || tokenRow.revoked) {
    throw Object.assign(
      new Error("Token has been revoked or does not exist."),
      { status: 401 }
    );
  }

  return {
    userId: payload.sub,
    email: payload.email,
  };
}
