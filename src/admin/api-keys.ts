/**
 * API Key management for Boltstore — machine-to-machine authentication.
 *
 * API keys provide scoped, non-expiring credentials for programmatic
 * access. Keys are hashed before storage (bcrypt via Bun.password);
 * the raw key is returned only once at creation time.
 *
 * Routes live under `/api/admin/api-keys` — admin only.
 *
 * @module boltstore/admin/api-keys
 */

import { DatabasePool } from "../db/pool";
import { hashPassword, verifyPassword } from "../auth";
import { generateSecureId } from "@boltstore/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid operations an API key can be scoped to. */
export const API_KEY_OPERATIONS = ["read", "create", "update", "delete", "admin"] as const;
export type ApiKeyOperation = (typeof API_KEY_OPERATIONS)[number];

/** Permission set attached to an API key. */
export interface ApiKeyPermissions {
  /** Allowed operations. An empty/missing list means no operations are allowed. */
  operations?: ApiKeyOperation[];
  /** Optional collection allow-list. If omitted, the key can access all collections. */
  collections?: string[];
}

/** Internal representation of an API key row. */
export interface ApiKey {
  id: string;
  name: string;
  /** First 8 chars of the raw key for display (the full hash is stored internally). */
  prefix: string;
  permissions: ApiKeyPermissions;
  /** Whether this key has been revoked. */
  revoked: boolean;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** ISO-8601 timestamp of last use. Null if never used. */
  last_used_at: string | null;
}

/** Full API key returned on creation (raw key + metadata). */
export interface ApiKeyWithSecret extends ApiKey {
  /** The raw API key secret. Only returned once at creation time. */
  secret: string;
}

/** Verified API key context after successful authentication. */
export interface ApiKeyContext {
  keyId: string;
  name: string;
  permissions: ApiKeyPermissions;
}

/** Map an HTTP/CRUD intent to an API-key operation name. */
export function operationForMethod(method: string): ApiKeyOperation {
  switch (method) {
    case "GET":
    case "HEAD":
      return "read";
    case "POST":
      return "create";
    case "PATCH":
    case "PUT":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "read";
  }
}

/** Check whether an API key context is allowed to perform an operation on a collection. */
export function apiKeyAllows(
  ctx: ApiKeyContext,
  operation: ApiKeyOperation,
  collection?: string
): boolean {
  const ops = ctx.permissions.operations ?? [];
  if (ops.includes("admin")) return true;
  if (!ops.includes(operation)) return false;
  const cols = ctx.permissions.collections;
  if (cols && cols.length > 0) {
    if (!collection || !cols.includes(collection)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY_PREFIX = "blt_";

// ---------------------------------------------------------------------------
// Table bootstrapping
// ---------------------------------------------------------------------------

/** Bootstrap the _api_keys table in a database. */
export function bootstrapApiKeyTables(pool: DatabasePool): void {
  const db = pool.write();

  db.run(`
    CREATE TABLE IF NOT EXISTS _api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{}',
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON _api_keys(prefix)
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique API key ID. */
function generateKeyId(): string {
  return generateSecureId("apk");
}

/** Generate a cryptographically random API key secret. */
function generateKeySecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Buffer.from(bytes).toString("base64url");
  return `${API_KEY_PREFIX}${raw}`;
}

/** Get current ISO-8601 timestamp. */
function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Public API — CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new API key. Returns the raw key — store it immediately,
 * as it will never be shown again.
 *
 * `POST /api/admin/:database/api-keys`
 */
export async function createApiKey(
  pool: DatabasePool,
  name: string,
  permissions: ApiKeyPermissions = {}
): Promise<ApiKeyWithSecret> {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw Object.assign(new Error("API key name is required."), { status: 400 });
  }
  if (name.length > 128) {
    throw Object.assign(new Error("API key name must be 128 characters or fewer."), { status: 400 });
  }

  // Validate permissions
  if (permissions.collections) {
    if (!Array.isArray(permissions.collections)) {
      throw Object.assign(new Error("permissions.collections must be an array."), { status: 400 });
    }
    for (const c of permissions.collections) {
      if (typeof c !== "string") {
        throw Object.assign(new Error("permissions.collections entries must be strings."), { status: 400 });
      }
    }
  }

  if (permissions.operations) {
    if (!Array.isArray(permissions.operations)) {
      throw Object.assign(new Error("permissions.operations must be an array."), { status: 400 });
    }
    for (const op of permissions.operations) {
      if (typeof op !== "string" || !API_KEY_OPERATIONS.includes(op as ApiKeyOperation)) {
        throw Object.assign(
          new Error(`Invalid operation "${op}". Valid operations: ${API_KEY_OPERATIONS.join(", ")}.`),
          { status: 400 }
        );
      }
    }
  }

  bootstrapApiKeyTables(pool);

  const secret = generateKeySecret();
  const keyHash = await hashPassword(secret);
  const id = generateKeyId();
  const prefix = secret.slice(0, 8);
  const ts = now();

  const db = pool.write();
  db.run(
    `INSERT INTO _api_keys (id, name, key_hash, prefix, permissions_json, revoked, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, NULL)`,
    [id, name.trim(), keyHash, prefix, JSON.stringify(permissions), ts]
  );

  return {
    id,
    name: name.trim(),
    prefix,
    secret,
    permissions,
    revoked: false,
    created_at: ts,
    last_used_at: null,
  };
}

/**
 * List all API keys for a database (without secrets).
 *
 * `GET /api/admin/:database/api-keys`
 */
export function listApiKeys(pool: DatabasePool): ApiKey[] {
  bootstrapApiKeyTables(pool);

  const db = pool.read();
  const rows = db
    .query("SELECT id, name, prefix, permissions_json, revoked, created_at, last_used_at FROM _api_keys ORDER BY created_at DESC")
    .all() as {
      id: string;
      name: string;
      prefix: string;
      permissions_json: string;
      revoked: number;
      created_at: string;
      last_used_at: string | null;
    }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    permissions: safeParseJson(row.permissions_json),
    revoked: row.revoked === 1,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  }));
}

/**
 * Get a single API key by ID (without secret).
 *
 * `GET /api/admin/:database/api-keys/:id`
 */
export function getApiKey(pool: DatabasePool, id: string): ApiKey {
  bootstrapApiKeyTables(pool);

  const db = pool.read();
  const row = db
    .query("SELECT id, name, prefix, permissions_json, revoked, created_at, last_used_at FROM _api_keys WHERE id=?")
    .get(id) as {
      id: string;
      name: string;
      prefix: string;
      permissions_json: string;
      revoked: number;
      created_at: string;
      last_used_at: string | null;
    } | null;

  if (!row) {
    throw Object.assign(new Error(`API key "${id}" not found.`), { status: 404 });
  }

  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    permissions: safeParseJson(row.permissions_json),
    revoked: row.revoked === 1,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

/**
 * Revoke an API key. After revocation, it can no longer be used for
 * authentication. This is irreversible.
 *
 * `DELETE /api/admin/:database/api-keys/:id`
 */
export function revokeApiKey(pool: DatabasePool, id: string): void {
  bootstrapApiKeyTables(pool);

  const db = pool.write();

  // Verify the key exists
  const existing = db
    .query("SELECT id FROM _api_keys WHERE id=?")
    .get(id) as { id: string } | null;

  if (!existing) {
    throw Object.assign(new Error(`API key "${id}" not found.`), { status: 404 });
  }

  db.run("UPDATE _api_keys SET revoked=1 WHERE id=?", [id]);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Verify an API key secret and return the associated permissions context.
 * Throws if the key is invalid, revoked, or not found.
 *
 * Used by the auth middleware to authenticate machine-to-machine requests.
 */
export async function verifyApiKey(
  pool: DatabasePool,
  secret: string
): Promise<ApiKeyContext> {
  if (!secret || typeof secret !== "string" || secret.length < 4) {
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  }

  bootstrapApiKeyTables(pool);

  // Look up by prefix first (efficient index scan)
  const prefix = secret.slice(0, 8);
  const db = pool.read();

  const candidates = db
    .query(
      "SELECT id, name, key_hash, permissions_json, revoked FROM _api_keys WHERE prefix=? AND revoked=0"
    )
    .all(prefix) as {
      id: string;
      name: string;
      key_hash: string;
      permissions_json: string;
      revoked: number;
    }[];

  for (const candidate of candidates) {
    const match = await verifyPassword(secret, candidate.key_hash);
    if (match) {
      // Update last_used_at
      try {
        pool.write().run("UPDATE _api_keys SET last_used_at=? WHERE id=?", [
          now(),
          candidate.id,
        ]);
      } catch {
        // Non-critical — don't fail auth for a tracking update
      }

      return {
        keyId: candidate.id,
        name: candidate.name,
        permissions: safeParseJson(candidate.permissions_json),
      };
    }
  }

  throw Object.assign(new Error("Invalid or revoked API key."), { status: 401 });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeParseJson(json: string): ApiKeyPermissions {
  try {
    return JSON.parse(json) as ApiKeyPermissions;
  } catch {
    return {};
  }
}