/**
 * Row-Level Security (RLS) for Boltstore collections.
 *
 * Policies are plain SQL WHERE clauses stored in `_collections` metadata
 * and AND-ed into every query for the collection. Tokens `$userId` and
 * `$email` are substituted with the authenticated user's actual values.
 *
 * If no policy is configured, the collection is open to all authenticated users.
 *
 * RLS only applies to non-admin routes (`/api/:database/*`).
 * Admin routes (`/api/admin/*`) are not affected.
 *
 * @module boltstore/rls
 */

import { DatabasePool } from "./db/pool";
import { toBindings } from "./db/cast";
import type { AuthContext } from "./middleware/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RLSConfig {
  /** SQL WHERE clause for read operations (SELECT). */
  read?: string;
  /** SQL WHERE clause for write operations (INSERT, UPDATE, DELETE). */
  write?: string;
}

export interface RLSContext {
  /** The authenticated user's ID. */
  userId: string;
  /** The authenticated user's email. */
  email: string;
}

export interface RLSResult {
  /** SQL WHERE clause to AND into the query. */
  whereClause: string;
  /** Parameter values for the WHERE clause. */
  params: unknown[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed tokens in RLS policies. */
const ALLOWED_TOKENS = new Set(["$userId", "$email"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Substitute $userId and $email tokens in a policy rule with actual values.
 */
function substituteTokens(rule: string, context: RLSContext): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const paramMap = new Map<string, string>();

  // Substitute $userId
  const withUserId = rule.replace(/\$userId\b/g, () => {
    const key = `$userId_${params.length}`;
    paramMap.set(key, context.userId);
    params.push(context.userId);
    return "?";
  });

  // Substitute $email
  const withEmail = withUserId.replace(/\$email\b/g, () => {
    const key = `$email_${params.length}`;
    paramMap.set(key, context.email);
    params.push(context.email);
    return "?";
  });

  // Validate no unknown tokens remain
  const unknownTokens = withEmail.match(/\$\w+/g);
  if (unknownTokens) {
    throw new Error(
      `Unknown RLS token(s): ${unknownTokens.join(", ")}. Allowed: ${[...ALLOWED_TOKENS].join(", ")}.`
    );
  }

  return { sql: withEmail, params };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the RLS policy for a collection and build the WHERE clause.
 *
 * Returns null if no policy is configured for the given operation,
 * meaning the collection is open to all authenticated users.
 *
 * @param pool - Database pool for the target database.
 * @param collection - The collection (table) name.
 * @param operation - "read" or "write".
 * @param context - The authenticated user's context (userId, email).
 */
export function applyRLS(
  pool: DatabasePool,
  collection: string,
  operation: "read" | "write",
  context: RLSContext
): RLSResult | null {
  const db = pool.read();

  // Read the policy rule from _collections metadata
  const column = operation === "read" ? "read_rule" : "write_rule";
  const row = db
    .query(`SELECT ${column} FROM _collections WHERE name=?`)
    .get(collection) as Record<string, string | null> | null;

  if (!row) {
    // Collection doesn't exist or isn't in _collections — no RLS
    return null;
  }

  const rule = row[column];
  if (!rule || rule.trim() === "") {
    // No policy configured — open to all
    return null;
  }

  const { sql, params } = substituteTokens(rule.trim(), context);

  return {
    whereClause: `(${sql})`,
    params,
  };
}

/**
 * Set or update RLS policies for a collection.
 *
 * Called internally by collection management — not directly exposed as a route.
 *
 * @param pool - Database pool.
 * @param collection - Collection name.
 * @param rls - The RLS configuration (read and/or write rules).
 */
export function setRLS(
  pool: DatabasePool,
  collection: string,
  rls: RLSConfig
): void {
  const db = pool.write();
  const updates: string[] = [];
  const params: unknown[] = [];

  if (rls.read !== undefined) {
    if (rls.read !== null && rls.read.length > 0) {
      validateRLSRule(rls.read);
    }
    updates.push("read_rule = ?");
    params.push(rls.read || null);
  }

  if (rls.write !== undefined) {
    if (rls.write !== null && rls.write.length > 0) {
      validateRLSRule(rls.write);
    }
    updates.push("write_rule = ?");
    params.push(rls.write || null);
  }

  if (updates.length === 0) return;

  params.push(collection);
  db.run(`UPDATE _collections SET ${updates.join(", ")} WHERE name=?`, toBindings(params));
}

/**
 * Convert the generic auth context into the RLS-specific context.
 * Returns null for API-key-authenticated requests because RLS applies only
 * to end-user principals.
 */
export function toRLSContext(auth: AuthContext): RLSContext | null {
  if (auth.isApiKey) return null;
  if (!auth.email) return null;
  return { userId: auth.principalId, email: auth.email };
}

/**
 * Validate an RLS rule for basic syntax.
 * Ensures only allowed tokens are used and the rule is a valid SQL expression.
 */
function validateRLSRule(rule: string): void {
  if (!rule || rule.trim().length === 0) return;

  // Check for tokens not in the ALLOWED_TOKENS set
  const tokens = rule.match(/\$\w+/g) || [];
  for (const token of tokens) {
    if (!ALLOWED_TOKENS.has(token)) {
      throw new Error(
        `Invalid RLS token "${token}". Allowed: ${[...ALLOWED_TOKENS].join(", ")}.`
      );
    }
  }
}