/**
 * API Key management for Boltstore — machine-to-machine authentication.
 *
 * API keys provide scoped, non-expiring credentials for programmatic
 * access. Keys are hashed before storage (bcrypt via Bun.password);
 * the raw key is returned only once at creation time.
 *
 * Two roles exist:
 *   - "admin" — global access to all databases and operations
 *   - "scoped" — restricted to specific databases, operations, and collections
 *
 * Routes live under `/api/admin/api-keys` — admin only.
 *
 * @module boltstore/admin/api-keys
 */

import { DatabasePool } from "../db/pool";
import { hashPassword, verifyPassword } from "../auth";
import { generateSecureId } from "@boltstore/utils";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid operations an API key can be scoped to. */
export const API_KEY_OPERATIONS = ["read", "create", "update", "delete"] as const;
export type ApiKeyOperation = (typeof API_KEY_OPERATIONS)[number];

/** Valid roles for an API key. */
export const API_KEY_ROLES = ["admin", "scoped"] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

/** Permission set attached to an API key. */
export interface ApiKeyPermissions {
  /** Key role: "admin" (global) or "scoped" (restricted). */
  role: ApiKeyRole;
  /** Allowed databases (for scoped keys). Ignored for admin keys. */
  allowedDatabases?: string[];
  /** Allowed operations. An empty/missing list means no operations are allowed. */
  allowedOperations?: ApiKeyOperation[];
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

/** Check whether an API key context is allowed to perform an operation on a database/collection. */
export function apiKeyAllows(
  ctx: ApiKeyContext,
  database: string,
  operation: ApiKeyOperation,
  collection?: string
): boolean {
  const perms = ctx.permissions;

  // Admin keys can do everything
  if (perms.role === "admin") return true;

  // Scoped keys must have the database in their allowed list.
  // An empty list means no database access at all (principle of least privilege).
  const dbs = perms.allowedDatabases ?? [];
  if (!dbs.includes("*") && !dbs.includes(database)) return false;

  // Check operation. When no operations are explicitly configured,
  // default to allowing all four operations for convenience.
  const ops = perms.allowedOperations && perms.allowedOperations.length > 0
    ? perms.allowedOperations
    : ["read", "create", "update", "delete"] as ApiKeyOperation[];
  if (!ops.includes(operation)) return false;

  // Check collection allow-list
  const cols = perms.collections;
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
      role TEXT NOT NULL DEFAULT 'scoped',
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      allowed_databases TEXT NOT NULL DEFAULT '[]',
      allowed_operations TEXT NOT NULL DEFAULT '[]',
      collections TEXT,
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

/** Extract a prefix from a raw API key secret for index lookup and rate-limit keying.
 *  The prefix includes `blt_` + 8 chars = 48 bits of searchable entropy. */
function extractKeyPrefix(secret: string): string {
  return secret.length >= 12 ? secret.slice(0, 12) : secret;
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
  permissions: ApiKeyPermissions = { role: "scoped" }
): Promise<ApiKeyWithSecret> {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw Object.assign(new Error("API key name is required."), { status: 400 });
  }
  if (name.length > 128) {
    throw Object.assign(new Error("API key name must be 128 characters or fewer."), { status: 400 });
  }

  // Validate role
  const role = permissions.role ?? "scoped";
  if (!API_KEY_ROLES.includes(role)) {
    throw Object.assign(
      new Error(`Invalid role "${role}". Valid roles: ${API_KEY_ROLES.join(", ")}.`),
      { status: 400 }
    );
  }

  // Validate allowed_databases (for scoped keys) — must be dbs_ IDs or "*"
  if (role !== "admin") {
    if (!permissions.allowedDatabases || !Array.isArray(permissions.allowedDatabases)) {
      throw Object.assign(
        new Error("Scoped API keys require an allowedDatabases array. Use [\"*\"] for all databases."),
        { status: 400 }
      );
    }
    if (permissions.allowedDatabases.length === 0) {
      throw Object.assign(
        new Error("Scoped API keys require at least one database in allowedDatabases. Use [\"*\"] for all databases."),
        { status: 400 }
      );
    }
    for (const db of permissions.allowedDatabases) {
      if (typeof db !== "string") {
        throw Object.assign(new Error("allowedDatabases entries must be strings."), { status: 400 });
      }
      if (db !== "*" && !db.startsWith("dbs_")) {
        throw Object.assign(
          new Error(`Invalid database identifier "${db}". Use database IDs (dbs_ prefix) or "*" for all.`),
          { status: 400 }
        );
      }
    }
  }

  // Validate allowed_operations
  if (permissions.allowedOperations) {
    if (!Array.isArray(permissions.allowedOperations)) {
      throw Object.assign(new Error("allowedOperations must be an array."), { status: 400 });
    }
    for (const op of permissions.allowedOperations) {
      if (typeof op !== "string" || !API_KEY_OPERATIONS.includes(op as ApiKeyOperation)) {
        throw Object.assign(
          new Error(`Invalid operation "${op}". Valid operations: ${API_KEY_OPERATIONS.join(", ")}.`),
          { status: 400 }
        );
      }
    }
  }

  // Validate collections
  if (permissions.collections) {
    if (!Array.isArray(permissions.collections)) {
      throw Object.assign(new Error("collections must be an array."), { status: 400 });
    }
    for (const c of permissions.collections) {
      if (typeof c !== "string") {
        throw Object.assign(new Error("collections entries must be strings."), { status: 400 });
      }
    }
  }

  bootstrapApiKeyTables(pool);

  const secret = generateKeySecret();
  const keyHash = await hashPassword(secret);
  const id = generateKeyId();
  const prefix = extractKeyPrefix(secret);
  const ts = now();

  const db = pool.write();
  db.run(
    `INSERT INTO _api_keys (id, name, role, key_hash, prefix, allowed_databases, allowed_operations, collections, revoked, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
    [
      id,
      name.trim(),
      role,
      keyHash,
      prefix,
      JSON.stringify(permissions.allowedDatabases ?? []),
      JSON.stringify(permissions.allowedOperations && permissions.allowedOperations.length > 0 ? permissions.allowedOperations : ["read", "create", "update", "delete"]),
      permissions.collections ? JSON.stringify(permissions.collections) : null,
      ts,
    ]
  );

  return {
    id,
    name: name.trim(),
    prefix,
    secret,
    permissions: {
      role,
      allowedDatabases: permissions.allowedDatabases ?? [],
      allowedOperations: permissions.allowedOperations && permissions.allowedOperations.length > 0 ? permissions.allowedOperations : ["read", "create", "update", "delete"],
      collections: permissions.collections,
    },
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
    .query("SELECT id, name, role, prefix, allowed_databases, allowed_operations, collections, revoked, created_at, last_used_at FROM _api_keys ORDER BY created_at DESC")
    .all() as {
      id: string;
      name: string;
      role: string;
      prefix: string;
      allowed_databases: string;
      allowed_operations: string;
      collections: string | null;
      revoked: number;
      created_at: string;
      last_used_at: string | null;
    }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    permissions: {
      role: row.role as ApiKeyRole,
      allowedDatabases: safeParseJsonArray(row.allowed_databases),
      allowedOperations: safeParseJsonArray(row.allowed_operations) as ApiKeyOperation[],
      collections: row.collections ? safeParseJsonArray(row.collections) : undefined,
    },
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
    .query("SELECT id, name, role, prefix, allowed_databases, allowed_operations, collections, revoked, created_at, last_used_at FROM _api_keys WHERE id=?")
    .get(id) as {
      id: string;
      name: string;
      role: string;
      prefix: string;
      allowed_databases: string;
      allowed_operations: string;
      collections: string | null;
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
    permissions: {
      role: row.role as ApiKeyRole,
      allowedDatabases: safeParseJsonArray(row.allowed_databases),
      allowedOperations: safeParseJsonArray(row.allowed_operations) as ApiKeyOperation[],
      collections: row.collections ? safeParseJsonArray(row.collections) : undefined,
    },
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
  const prefix = extractKeyPrefix(secret);
  const db = pool.read();

  const candidates = db
    .query(
      "SELECT id, name, role, key_hash, allowed_databases, allowed_operations, collections, revoked FROM _api_keys WHERE prefix=? AND revoked=0"
    )
    .all(prefix) as {
      id: string;
      name: string;
      role: string;
      key_hash: string;
      allowed_databases: string;
      allowed_operations: string;
      collections: string | null;
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
        permissions: {
          role: candidate.role as ApiKeyRole,
          allowedDatabases: safeParseJsonArray(candidate.allowed_databases),
          allowedOperations: safeParseJsonArray(candidate.allowed_operations) as ApiKeyOperation[],
          collections: candidate.collections ? safeParseJsonArray(candidate.collections) : undefined,
        },
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
    return { role: "scoped" };
  }
}

function safeParseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    logger.warn("Failed to parse stored JSON array", { value: json ? json.slice(0, 200) : "empty" });
    return [];
  }
}