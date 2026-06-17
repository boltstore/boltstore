/**
 * Authentication module for Boltstore.
 *
 * Uses Bun's built-in `Bun.password` for bcrypt password hashing and
 * `Bun.CryptoHasher` for HMAC-SHA256 JWT signing. No third-party
 * libraries required.
 *
 * Users are stored per-database in the `_users` table. Tokens are
 * tracked in `_tokens` for revocation support.
 *
 * @module boltstore/auth
 */

import { DatabasePool } from "./db/pool";
import { validateIdentifier, generateSecureId } from "@boltstore/utils";
import { markPasswordSet } from "./admin/oauth";
import { applyRLS, toRLSContext, type RLSContext } from "./rls";
import type { AuthContext } from "./middleware/auth";

export { generateSecureId };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthConfig {
  /** HMAC-SHA256 secret for JWT signing. Required for production. */
  secret?: string;
  /** Access token expiry in seconds. Default: 900 (15 minutes). */
  accessTokenExpiry?: number;
  /** Refresh token expiry in seconds. Default: 604800 (7 days). */
  refreshTokenExpiry?: number;
}

export interface User {
  /** Unique user ID. */
  id: string;
  /** Email address (unique per database, stored lowercase). */
  email: string;
  /** Role: "user" or "admin". */
  role: "user" | "admin";
  /** ISO-8601 timestamp of when the user was created. */
  created_at: string;
  /** ISO-8601 timestamp of the last profile update. */
  updated_at: string;
}

/** Internal user row including the oauth_only flag. */
export interface UserRow extends User {
  oauth_only?: number;
  password_hash?: string;
}

export interface TokenPair {
  /** Short-lived JWT access token. */
  accessToken: string;
  /** Long-lived JWT refresh token. */
  refreshToken: string;
  /** Access token expiry in seconds from now. */
  expiresIn: number;
  /** User ID the token pair was issued for. */
  userId?: string;
  /** User email the token pair was issued for. */
  email?: string;
  /** User role the token pair was issued for. */
  role?: "user" | "admin";
}

export interface JwtPayload {
  /** Subject (user ID). */
  sub: string;
  /** User email. */
  email: string;
  /** User role. */
  role: "user" | "admin";
  /** Issued at (Unix timestamp). */
  iat: number;
  /** Expiry (Unix timestamp). */
  exp: number;
  /** JWT ID (unique per token). */
  jti: string;
  /** Token type. */
  type?: "access" | "refresh";
  /** Audience (database domain binding). */
  aud?: string;
  /** Issuer claim. */
  iss?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ACCESS_EXPIRY = 900;       // 15 minutes
const DEFAULT_REFRESH_EXPIRY = 604800;   // 7 days
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Table bootstrapping
// ---------------------------------------------------------------------------

/** Bootstrap the _users and _tokens tables. */
export function bootstrapAuthTables(pool: DatabasePool): void {
  const db = pool.write();

  db.run(`
    CREATE TABLE IF NOT EXISTS _users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      oauth_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Migrate older _users tables to include the oauth_only column.
  try { db.run("ALTER TABLE _users ADD COLUMN oauth_only INTEGER NOT NULL DEFAULT 0"); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS _tokens (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_user_expires ON _tokens(user_id, expires_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_expires ON _tokens(expires_at)
  `);
}

let tokenCleanupIntervals: Map<DatabasePool, ReturnType<typeof setInterval>> = new Map();

/**
 * Start a periodic cleanup of expired and revoked tokens for a specific pool.
 * Default interval: 5 minutes.
 */
export function startTokenCleanup(pool: DatabasePool, intervalMs = 5 * 60 * 1000): void {
  if (tokenCleanupIntervals.has(pool)) return;
  const interval = setInterval(() => {
    try {
      const db = pool.write();
      db.run("DELETE FROM _tokens WHERE expires_at < datetime('now') OR revoked = 1");
    } catch {
      // Ignore cleanup errors.
    }
  }, intervalMs);
  tokenCleanupIntervals.set(pool, interval);
}

/**
 * Stop the periodic token cleanup task for a specific pool, or all pools if none given.
 */
export function stopTokenCleanup(pool?: DatabasePool): void {
  if (pool) {
    const interval = tokenCleanupIntervals.get(pool);
    if (interval) {
      clearInterval(interval);
      tokenCleanupIntervals.delete(pool);
    }
  } else {
    for (const interval of tokenCleanupIntervals.values()) {
      clearInterval(interval);
    }
    tokenCleanupIntervals.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique user ID. */
function generateUserId(): string {
  return generateSecureId("usr");
}

/** Generate a unique JWT ID. */
function generateJti(): string {
  return generateSecureId("jti");
}

/** Get current ISO-8601 timestamp. */
function now(): string {
  return new Date().toISOString();
}

/** Get current Unix timestamp in seconds. */
function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Validate email format. */
function validateEmail(email: string): void {
  if (!email || typeof email !== "string") {
    throw Object.assign(new Error("Email is required."), { status: 400 });
  }
  if (email.length > 254) {
    throw Object.assign(new Error("Email exceeds maximum length."), { status: 400 });
  }
  if (email.toLowerCase() !== email || email.includes("\n") || email.includes("\r")) {
    throw Object.assign(new Error("Invalid email format."), { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    throw Object.assign(new Error("Invalid email format."), { status: 400 });
  }
}

/** Validate password strength. */
function validatePassword(password: string): void {
  if (!password || typeof password !== "string") {
    throw Object.assign(new Error("Password is required."), { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(
      new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
      { status: 400 }
    );
  }
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/**
 * Hash a password using bcrypt (Bun.password).
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  });
}

/**
 * Verify a password against a bcrypt hash. Constant-time comparison.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

/** Base64url encode (no padding). */
function base64urlEncode(data: ArrayBuffer | Buffer): string {
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("base64url");
  }
  return data.toString("base64url");
}

/**
 * Sign a JWT using HMAC-SHA256 (Bun.CryptoHasher).
 */
function signJwt(payload: Record<string, unknown>, secret: string, audience?: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const fullPayload: Record<string, unknown> = audience ? { ...payload, iss: "boltstore", aud: audience } : { ...payload, iss: "boltstore" };
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;

  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(signingInput);
  const signature = base64urlEncode(hasher.digest());

  return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT signature and return the decoded payload.
 * Throws if the token is invalid, expired, or malformed.
 */
function verifyJwt(token: string, secret: string, audience?: string): JwtPayload {
  if (!token || typeof token !== "string") {
    throw Object.assign(new Error("Missing or invalid token."), { status: 401 });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw Object.assign(new Error("Invalid token format."), { status: 401 });
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode and validate header
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
  } catch {
    throw Object.assign(new Error("Invalid token header."), { status: 401 });
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw Object.assign(new Error("Unsupported token algorithm or type."), { status: 401 });
  }

  // Verify signature (constant-time)
  const signingInput = `${headerB64}.${payloadB64}`;
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(signingInput);
  const expectedSig = base64urlEncode(hasher.digest());

  // Constant-time comparison
  const expectedBuf = Buffer.from(expectedSig);
  const actualBuf = Buffer.from(signatureB64);
  if (expectedBuf.length !== actualBuf.length) {
    throw Object.assign(new Error("Invalid token signature."), { status: 401 });
  }
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw Object.assign(new Error("Invalid token signature."), { status: 401 });
  }

  // Decode payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    throw Object.assign(new Error("Invalid token payload."), { status: 401 });
  }

  // Check expiry with small clock skew allowance
  const now = unixNow();
  if (payload.exp && payload.exp < now - 60) {
    throw Object.assign(new Error("Token has expired."), { status: 401 });
  }

  // Validate required fields
  if (!payload.sub || !payload.jti) {
    throw Object.assign(new Error("Invalid token claims."), { status: 401 });
  }

  // Validate audience (database binding)
  if (audience && payload.aud !== audience) {
    throw Object.assign(new Error("Invalid token audience."), { status: 401 });
  }

  // Validate issuer
  if (payload.iss !== "boltstore") {
    throw Object.assign(new Error("Invalid token issuer."), { status: 401 });
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Public API — User management
// ---------------------------------------------------------------------------

/**
 * Register a new user.
 *
 * `POST /api/auth/register`
 */
export async function registerUser(
  pool: DatabasePool,
  email: string,
  password: string
): Promise<User> {
  validateEmail(email);
  validatePassword(password);

  bootstrapAuthTables(pool);

  const passwordHash = await hashPassword(password);
  const id = generateUserId();
  const ts = now();

  return pool.writeTransaction(() => {
    const db = pool.write();

    // Check for duplicate email
    const existing = db.query("SELECT 1 FROM _users WHERE email=?").get(email);
    if (existing) {
      throw Object.assign(
        new Error("A user with this email already exists."),
        { status: 409 }
      );
    }

    db.run(
      `INSERT INTO _users (id, email, password_hash, role, oauth_only, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), passwordHash, "user", 0, ts, ts]
    );

    return { id, email, role: "user" as const, created_at: ts, updated_at: ts };
  });
}

/**
 * Issue a fresh access/refresh token pair for an existing user.
 */
export function createTokenPairForUser(
  pool: DatabasePool,
  user: { id: string; email: string; role: string },
  config: AuthConfig
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
    role: user.role,
    type: "access",
    jti: accessJti,
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
    role: user.role as "user" | "admin",
  };
}

/**
 * Authenticate a user and return a token pair.
 *
 * `POST /api/auth/login`
 */
export async function loginUser(
  pool: DatabasePool,
  email: string,
  password: string,
  config: AuthConfig
): Promise<TokenPair> {
  validateEmail(email);
  validatePassword(password);

  if (!config.secret) {
    throw Object.assign(
      new Error("JWT secret is not configured. Set JWT_SECRET environment variable."),
      { status: 500 }
    );
  }

  bootstrapAuthTables(pool);

  const db = pool.read();
  const row = db
    .query("SELECT id, email, password_hash, role, oauth_only FROM _users WHERE email=?")
    .get(email.toLowerCase()) as { id: string; email: string; password_hash: string; role: string; oauth_only: number } | null;

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

  return createTokenPairForUser(pool, { id: row.id, email: row.email, role: row.role }, config);
}

/**
 * Refresh an access token using a refresh token.
 *
 * `POST /api/auth/refresh`
 */
export async function refreshAccessToken(
  pool: DatabasePool,
  refreshToken: string,
  config: AuthConfig
): Promise<TokenPair> {
  if (!config.secret) {
    throw Object.assign(
      new Error("JWT secret is not configured."),
      { status: 500 }
    );
  }

  // Verify the refresh token
  const payload = verifyJwt(refreshToken, config.secret);
  if (payload.type !== "refresh") {
    throw Object.assign(
      new Error("Invalid token type. Expected a refresh token."),
      { status: 401 }
    );
  }

  // Check if the token has been revoked
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

  // Verify user still exists
  const userRow = db
    .query("SELECT id, email, role FROM _users WHERE id=?")
    .get(payload.sub) as { id: string; email: string; role: string } | null;

  if (!userRow) {
    throw Object.assign(
      new Error("User no longer exists."),
      { status: 401 }
    );
  }

  // Revoke the old refresh token
  pool.write().run("UPDATE _tokens SET revoked=1 WHERE jti=?", [payload.jti]);

  return createTokenPairForUser(pool, userRow, config);
}

/**
 * Logout a user by revoking all their tokens.
 *
 * `POST /api/auth/logout`
 */
export function logoutUser(pool: DatabasePool, userId: string): void {
  bootstrapAuthTables(pool);
  pool.write().run("DELETE FROM _tokens WHERE user_id=?", [userId]);
}

/**
 * Get a user by ID.
 */
export function getUserById(
  pool: DatabasePool,
  userId: string
): User {
  bootstrapAuthTables(pool);
  const db = pool.read();

  const row = db
    .query("SELECT id, email, role, created_at, updated_at FROM _users WHERE id=?")
    .get(userId) as User | null;

  if (!row) {
    throw Object.assign(
      new Error(`User "${userId}" not found.`),
      { status: 404 }
    );
  }

  return row;
}

/**
 * Update a user's profile (email and/or password).
 *
 * `PATCH /api/:database/auth/me`
 */
export async function updateProfile(
  pool: DatabasePool,
  userId: string,
  data: { email?: string; password?: string }
): Promise<User> {
  if (!data.email && !data.password) {
    throw Object.assign(
      new Error("At least one of 'email' or 'password' must be provided."),
      { status: 400 }
    );
  }

  bootstrapAuthTables(pool);

  // Verify user exists
  const db = pool.read();
  const existing = db
    .query("SELECT id, email, role, created_at, updated_at FROM _users WHERE id=?")
    .get(userId) as User | null;

  if (!existing) {
    throw Object.assign(
      new Error(`User "${userId}" not found.`),
      { status: 404 }
    );
  }

  let passwordHash: string | undefined;
  if (data.password) {
    validatePassword(data.password);
    passwordHash = await hashPassword(data.password);
  }

  return pool.writeTransaction(() => {
    const writeDb = pool.write();
    const ts = now();

    if (data.email) {
      validateEmail(data.email);
      const normalizedEmail = data.email.toLowerCase();

      // Check for duplicate email
      const dup = writeDb
        .query("SELECT 1 FROM _users WHERE email=? AND id!=?")
        .get(normalizedEmail, userId);
      if (dup) {
        throw Object.assign(
          new Error("A user with this email already exists."),
          { status: 409 }
        );
      }

      writeDb.run("UPDATE _users SET email=?, updated_at=? WHERE id=?", [normalizedEmail, ts, userId]);
    }

    if (passwordHash) {
      writeDb.run("UPDATE _users SET password_hash=?, oauth_only=0, updated_at=? WHERE id=?", [passwordHash, ts, userId]);
      markPasswordSet(pool, userId);
    } else if (data.email) {
      writeDb.run("UPDATE _users SET updated_at=? WHERE id=?", [ts, userId]);
    }

    // Return updated user
    const updated = writeDb
      .query("SELECT id, email, role, created_at, updated_at FROM _users WHERE id=?")
      .get(userId) as User;

    return updated;
  });
}

/**
 * Verify an access token and return the user context.
 * Checks JWT signature, expiry, and token revocation status.
 */
export function verifyAccessToken(
  pool: DatabasePool,
  token: string,
  config: AuthConfig
): { userId: string; email: string; role: "user" | "admin" } {
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

  // Check revocation
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
    role: payload.role,
  };
}

/** Generate a cryptographically random password for OAuth users. */
export async function generateRandomPassword(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return await hashPassword(Buffer.from(bytes).toString("base64url"));
}
