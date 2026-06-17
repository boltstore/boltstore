/**
 * Tests for the authentication module.
 *
 * @module tests/auth
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../src/db/manager";
import {
  bootstrapAuthTables,
  hashPassword,
  verifyPassword,
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  getUserById,
  verifyAccessToken,
  type AuthConfig,
  type User,
} from "../src/auth";
import { mkdirSync, rmSync } from "node:fs";

const TEST_DATA_DIR = "/tmp/boltstore_test_auth";
const TEST_APP = "authapp";
const TEST_SECRET = "test-secret-key-for-jwt-signing-minimum-256-bits";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;
let config: AuthConfig;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(() => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  manager.createDatabase(TEST_APP);
  pool = manager.get(TEST_APP);
  config = { secret: TEST_SECRET };
});

afterAll(() => cleanup());

beforeEach(() => {
  // Reset: drop auth tables
  const db = pool.write();
  try { db.run("DROP TABLE IF EXISTS _tokens"); } catch {}
  try { db.run("DROP TABLE IF EXISTS _users"); } catch {}
});

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

describe("Password hashing", () => {
  test("hashPassword returns a bcrypt hash", async () => {
    const hash = await hashPassword("my-password-123");
    expect(hash).toStartWith("$2");
    expect(hash.length).toBeGreaterThan(50);
  });

  test("verifyPassword returns true for correct password", async () => {
    const hash = await hashPassword("correct-horse");
    const valid = await verifyPassword("correct-horse", hash);
    expect(valid).toBe(true);
  });

  test("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    const valid = await verifyPassword("wrong-password", hash);
    expect(valid).toBe(false);
  });

  test("each hash is unique (salt)", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// registerUser
// ---------------------------------------------------------------------------

describe("registerUser", () => {
  test("registers a new user", async () => {
    const user = await registerUser(pool, "alice@example.com", "password123");
    expect(user.id).toStartWith("usr_");
    expect(user.email).toBe("alice@example.com");
    expect(user.role).toBe("user");
    expect(user.created_at).toBeTruthy();
    expect(user.updated_at).toBeTruthy();
    // Password hash must never be returned
    expect((user as Record<string, unknown>).password_hash).toBeUndefined();
  });

  test("returns 409 for duplicate email", async () => {
    await registerUser(pool, "bob@example.com", "password123");
    try {
      await registerUser(pool, "bob@example.com", "another456");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(409);
    }
  });

  test("rejects invalid email format", async () => {
    try {
      await registerUser(pool, "not-an-email", "password123");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects short password", async () => {
    try {
      await registerUser(pool, "test@example.com", "short");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("rejects empty email", async () => {
    try {
      await registerUser(pool, "", "password123");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(400);
    }
  });

  test("bootstrap creates tables on first call", async () => {
    // Tables don't exist yet (dropped in beforeEach)
    const db = pool.read();
    const usersTable = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_users'").get();
    expect(usersTable).toBeNull();

    await registerUser(pool, "first@example.com", "password123");

    const after = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_users'").get();
    expect(after).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loginUser
// ---------------------------------------------------------------------------

describe("loginUser", () => {
  test("returns token pair for valid credentials", async () => {
    await registerUser(pool, "charlie@example.com", "password123");
    const tokens = await loginUser(pool, "charlie@example.com", "password123", config);

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.expiresIn).toBeGreaterThan(0);
    // Access token should be a JWT (header.payload.signature)
    expect(tokens.accessToken.split(".").length).toBe(3);
    expect(tokens.refreshToken.split(".").length).toBe(3);
  });

  test("returns 401 for invalid password", async () => {
    await registerUser(pool, "dave@example.com", "correct-password");
    try {
      await loginUser(pool, "dave@example.com", "wrong-password", config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("returns 401 for non-existent user", async () => {
    try {
      await loginUser(pool, "ghost@example.com", "password123", config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("blocks password login for OAuth-only accounts", async () => {
    const email = "oauthonly@example.com";
    const password = "password123";
    await registerUser(pool, email, password);
    pool.write().run("UPDATE _users SET oauth_only=1 WHERE email=?", [email]);
    try {
      await loginUser(pool, email, password, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(403);
    }
  });

  test("returns 500 when JWT secret is not configured", async () => {
    await registerUser(pool, "eve@example.com", "password123");
    try {
      await loginUser(pool, "eve@example.com", "password123", {});
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyAccessToken
// ---------------------------------------------------------------------------

describe("verifyAccessToken", () => {
  test("verifies a valid access token", async () => {
    await registerUser(pool, "frank@example.com", "password123");
    const tokens = await loginUser(pool, "frank@example.com", "password123", config);

    const context = verifyAccessToken(pool, tokens.accessToken, config);
    expect(context.userId).toBeTruthy();
    expect(context.email).toBe("frank@example.com");
    expect(context.role).toBe("user");

    // Issuer claim is present and verified.
    const payloadB64 = tokens.accessToken.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    expect(payload.iss).toBe("boltstore");
  });

  test("returns 401 for invalid token", async () => {
    try {
      verifyAccessToken(pool, "not.a.valid.jwt", config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("returns 401 for refresh token used as access token", async () => {
    await registerUser(pool, "grace@example.com", "password123");
    const tokens = await loginUser(pool, "grace@example.com", "password123", config);

    try {
      verifyAccessToken(pool, tokens.refreshToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("returns 401 for revoked token", async () => {
    await registerUser(pool, "henry@example.com", "password123");
    const tokens = await loginUser(pool, "henry@example.com", "password123", config);

    const context = verifyAccessToken(pool, tokens.accessToken, config);
    expect(context.email).toBe("henry@example.com");

    // Logout revokes all tokens
    logoutUser(pool, context.userId);

    // Same token should now be rejected
    try {
      verifyAccessToken(pool, tokens.accessToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------

describe("refreshAccessToken", () => {
  test("returns a new token pair", async () => {
    await registerUser(pool, "iris@example.com", "password123");
    const tokens = await loginUser(pool, "iris@example.com", "password123", config);

    const newTokens = await refreshAccessToken(pool, tokens.refreshToken, config);

    expect(newTokens.accessToken).toBeTruthy();
    expect(newTokens.refreshToken).toBeTruthy();
    expect(newTokens.accessToken).not.toBe(tokens.accessToken);
    expect(newTokens.refreshToken).not.toBe(tokens.refreshToken);
  });

  test("revokes old refresh token after use", async () => {
    await registerUser(pool, "jack@example.com", "password123");
    const tokens = await loginUser(pool, "jack@example.com", "password123", config);

    // First refresh should work
    const newTokens = await refreshAccessToken(pool, tokens.refreshToken, config);
    expect(newTokens.accessToken).toBeTruthy();

    // Old refresh token should now be revoked
    try {
      await refreshAccessToken(pool, tokens.refreshToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("returns 401 for access token used as refresh token", async () => {
    await registerUser(pool, "kate@example.com", "password123");
    const tokens = await loginUser(pool, "kate@example.com", "password123", config);

    try {
      await refreshAccessToken(pool, tokens.accessToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// logoutUser
// ---------------------------------------------------------------------------

describe("logoutUser", () => {
  test("revokes all user tokens", async () => {
    await registerUser(pool, "liam@example.com", "password123");
    const tokens = await loginUser(pool, "liam@example.com", "password123", config);

    const context = verifyAccessToken(pool, tokens.accessToken, config);
    logoutUser(pool, context.userId);

    // Access token should be revoked
    try {
      verifyAccessToken(pool, tokens.accessToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }

    // Refresh token should be revoked
    try {
      await refreshAccessToken(pool, tokens.refreshToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("does not throw for non-existent user", () => {
    logoutUser(pool, "usr_nonexistent");
    // Should not throw
  });
});

// ---------------------------------------------------------------------------
// getUserById
// ---------------------------------------------------------------------------

describe("getUserById", () => {
  test("returns user by ID", async () => {
    const created = await registerUser(pool, "mia@example.com", "password123");
    const user = getUserById(pool, created.id);
    expect(user.email).toBe("mia@example.com");
    expect(user.role).toBe("user");
  });

  test("returns 404 for non-existent user", () => {
    try {
      getUserById(pool, "usr_ghost");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(404);
    }
  });

  test("never exposes password hash", async () => {
    const created = await registerUser(pool, "noah@example.com", "password123");
    const user = getUserById(pool, created.id);
    expect((user as Record<string, unknown>).password_hash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: full auth flow
// ---------------------------------------------------------------------------

describe("Full auth flow", () => {
  test("register → login → verify → refresh → logout", async () => {
    // Register
    const user = await registerUser(pool, "olivia@example.com", "secure1234");
    expect(user.email).toBe("olivia@example.com");

    // Login
    const tokens = await loginUser(pool, "olivia@example.com", "secure1234", config);
    expect(tokens.accessToken).toBeTruthy();

    // Verify
    const ctx = verifyAccessToken(pool, tokens.accessToken, config);
    expect(ctx.email).toBe("olivia@example.com");

    // Get user by ID
    const fetched = getUserById(pool, ctx.userId);
    expect(fetched.email).toBe("olivia@example.com");

    // Refresh
    const newTokens = await refreshAccessToken(pool, tokens.refreshToken, config);
    expect(newTokens.accessToken).not.toBe(tokens.accessToken);

    // Verify new token
    const ctx2 = verifyAccessToken(pool, newTokens.accessToken, config);
    expect(ctx2.email).toBe("olivia@example.com");

    // Logout
    logoutUser(pool, ctx2.userId);

    // Verify revoked
    try {
      verifyAccessToken(pool, newTokens.accessToken, config);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as { status?: number };
      expect(e.status).toBe(401);
    }
  });
});