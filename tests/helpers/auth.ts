import { DatabasePool } from "../../src/db/pool";
import { DatabaseManager } from "../../src/db/manager";
import { bootstrapAuthTables, hashPassword, type AuthConfig } from "../../src/auth";
import { createApiKey } from "../../src/admin/api-keys";
import { generateSecureId } from "@boltstore/utils";

export const TEST_SECRET = "test-secret-key-for-jwt-signing-minimum-256-bits";

export function testAuthConfig(): AuthConfig {
  return { secret: TEST_SECRET, accessTokenExpiry: 3600 };
}

/** Insert a user directly and return a valid access token. */
export async function createUserAndToken(
  pool: DatabasePool,
  email = "user@boltstore.local"
): Promise<{ userId: string; email: string; token: string }> {
  bootstrapAuthTables(pool);
  const passwordHash = await hashPassword("user-password-123");
  const userId = generateSecureId("usr");
  const ts = new Date().toISOString();

  const db = pool.write();
  db.run(
    "INSERT INTO _users (id, email, password_hash, oauth_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, email.toLowerCase(), passwordHash, 0, ts, ts]
  );

  const accessJti = generateSecureId("jti");
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    email: email.toLowerCase(),
    type: "access",
    jti: accessJti,
    iss: "boltstore",
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;
  const hasher = new Bun.CryptoHasher("sha256", TEST_SECRET);
  hasher.update(signingInput);
  const signature = Buffer.from(hasher.digest()).toString("base64url");
  const token = `${signingInput}.${signature}`;

  db.run(
    "INSERT INTO _tokens (jti, user_id, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [accessJti, userId, "access", new Date((nowSec + 3600) * 1000).toISOString(), ts]
  );

  return { userId, email, token };
}

/** Create a user-scoped API key for record-level routes. */
export async function createUserApiKey(pool: DatabasePool): Promise<string> {
  const key = await createApiKey(pool, "test-key", { operations: ["read", "create", "update", "delete"] });
  return key.secret;
}

/** Create an admin API key for global admin routes. */
export async function createAdminApiKey(pool: DatabasePool): Promise<string> {
  const key = await createApiKey(pool, "test-admin-key", { operations: ["admin"] });
  return key.secret;
}

/** Create a fresh DatabaseManager and a single test database with an admin API key. */
export async function setupTestEnvironment(
  dataDir: string,
  appName: string
): Promise<{
  manager: DatabaseManager;
  pool: DatabasePool;
  authHeaders: Record<string, string>;
}> {
  const manager = new DatabaseManager({ dataDir });
  manager.createDatabase(appName);
  const pool = manager.get(appName);
  const apiKey = await createAdminApiKey(pool);
  return {
    manager,
    pool,
    authHeaders: { Authorization: `Bearer ${apiKey}` },
  };
}
