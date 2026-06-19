/**
 * Rate limiting middleware for Boltstore.
 *
 * Uses a sliding-window counter approach with per-IP, per-(normalized)endpoint,
 * per-tier tracking. All state is in-memory (no SQLite dependency) for
 * speed — resets on server restart.
 *
 * Security: the path key is normalized to strip dynamic segments (record IDs,
 * database IDs) so an attacker cannot exhaust memory by rotating through
 * unique paths. A fixed-size LRU-like eviction is used via periodic cleanup
 * and a max bucket count ceiling.
 *
 * Three tiers:
 * - **public**: Unauthenticated endpoints (health, login, register)
 * - **auth**: Authenticated endpoints (CRUD, queries)
 * - **admin**: Admin endpoints under `/api/admin/*`
 *
 * Configurable via `BoltstoreConfig.rateLimitPublic` and `rateLimitAuth`,
 * or set explicitly in `ServerConfig.rateLimit`.
 *
 * @module boltstore/middleware/rate-limit
 */

import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitTier = "public" | "auth" | "admin";

export interface RateLimitConfig {
  /** Requests per window for public endpoints. Default: 100. */
  public: number;
  /** Requests per window for authenticated endpoints. Default: 1000. */
  auth: number;
  /** Requests per window for admin endpoints. Default: 500. */
  admin: number;
  /** Requests per window for API keys (if not provided, uses auth tier). Default: 5000. */
  apiKey?: number;
  /** Window size in seconds. Default: 60 (1 minute). */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in this window. */
  remaining: number;
  /** Total limit for this tier. */
  limit: number;
  /** Unix timestamp (seconds) when the window resets. */
  reset: number;
  /** Seconds until the window resets (only set when rate-limited). */
  retryAfter: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  public: 100,
  auth: 1000,
  admin: 500,
  windowSeconds: 60,
};

// ---------------------------------------------------------------------------
// Sliding-window counter state
// ---------------------------------------------------------------------------

interface WindowBucket {
  /** Timestamp (ms) of the last reset. */
  resetAt: number;
  /** Counter of requests in this window. */
  count: number;
}

/**
 * Key format: `${tier}:${clientIp}:${normalizedPath}`
 *
 * The path is normalized to strip dynamic segments (record IDs, database IDs),
 * preventing memory exhaustion via unique path rotation.
 */
const buckets = new Map<string, WindowBucket>();

/** Maximum number of rate-limit buckets before we evict oldest entries. */
const MAX_BUCKETS = 10_000;

/**
 * Periodically clean up expired buckets to prevent memory leaks.
 * Runs every 60 seconds, removes buckets older than 2× the window.
 * Also evicts oldest entries if the map exceeds MAX_BUCKETS.
 */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(maxWindowSeconds: number): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = maxWindowSeconds * 2000;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, bucket] of buckets) {
      if (now - bucket.resetAt > maxAge) {
        buckets.delete(key);
      } else if (bucket.resetAt < oldestTime) {
        oldestTime = bucket.resetAt;
        oldestKey = key;
      }
    }
    if (buckets.size > MAX_BUCKETS && oldestKey) {
      buckets.delete(oldestKey);
    }
  }, 60_000);
}

/**
 * Stop the cleanup timer. Call during server shutdown.
 */
export function stopRateLimitCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Normalize a URL pathname for rate-limit keying:
 * - Strips trailing slashes
 * - Collapses `/api/:database/` to `/api/:db/` (hides database IDs)
 * - Collapses `/api/:database/collections/:collection/records/:id` to `/api/:db/collections/:col/records/:id`
 * - Collapses `/api/admin/:database/` to `/api/admin/:db/`
 * This prevents attackers from creating unique buckets per record ID.
 */
export function normalizePathForKey(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const parts = clean.split("/");
  // Normalize known dynamic segments
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("dbs_")) {
      result.push(":db");
    } else if (part.startsWith("rec_") || part.startsWith("apk_") || part.startsWith("bkp_") || part.startsWith("col_") || part.startsWith("mig_")) {
      result.push(":id");
    } else if (part.startsWith("usr_") || part.startsWith("tok_")) {
      result.push(":id");
    } else {
      result.push(part);
    }
  }
  return result.join("/");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a request should be rate-limited.
 *
 * @param clientIp - The client's IP address (or "127.0.0.1" as fallback).
 * @param pathname - The request path (used as part of the rate limit key).
 * @param tier - The rate limit tier for this request.
 * @param config - Rate limit configuration.
 * @param apiKeyPrefix - Optional API key prefix for differentiated rate limiting.
 * @returns A result indicating whether the request is allowed.
 */
export function checkRateLimit(
  clientIp: string,
  pathname: string,
  tier: RateLimitTier,
  config: RateLimitConfig,
  apiKeyPrefix?: string
): RateLimitResult {
  startCleanup(config.windowSeconds);

  const limit = config[tier] ?? config.public;
  const windowMs = config.windowSeconds * 1000;

  const normalizedPath = normalizePathForKey(pathname);

  // For API key holders, include the key prefix for differentiated quotas
  const effectiveTier = apiKeyPrefix ? "apiKey" : tier;
  const effectiveLimit = apiKeyPrefix
    ? (config.apiKey ?? config.auth)
    : limit;

  const key = apiKeyPrefix
    ? `apikey:${apiKeyPrefix}:${normalizedPath}`
    : `${effectiveTier}:${clientIp}:${normalizedPath}`;

  // Enforce max bucket count before creating new entries
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    logger.warn("Rate-limit bucket map full, evicting oldest entry", { bucket_count: buckets.size });
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, b] of buckets) {
      if (b.resetAt < oldestTime) {
        oldestTime = b.resetAt;
        oldestKey = k;
      }
    }
    if (oldestKey) buckets.delete(oldestKey);
  }

  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.resetAt > windowMs) {
    bucket = { resetAt: now, count: 0 };
    buckets.set(key, bucket);
  }

  // Check before incrementing: reject only when count >= limit
  if (bucket.count >= effectiveLimit) {
    const remaining = 0;
    const reset = Math.floor((bucket.resetAt + windowMs) / 1000);
    const retryAfter = Math.ceil((bucket.resetAt + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining,
      limit: effectiveLimit,
      reset,
      retryAfter,
    };
  }

  bucket.count++;

  const remaining = effectiveLimit - bucket.count;
  const reset = Math.floor((bucket.resetAt + windowMs) / 1000);
  return {
    allowed: true,
    remaining,
    limit: effectiveLimit,
    reset,
    retryAfter: 0,
  };
}

/**
 * Get the current rate limit status for a client without incrementing.
 * Useful for informational endpoints.
 */
export function getRateLimitStatus(
  clientIp: string,
  pathname: string,
  tier: RateLimitTier,
  config: RateLimitConfig
): RateLimitResult {
  const limit = config[tier] ?? config.public;
  const windowMs = config.windowSeconds * 1000;

  const normalizedPath = normalizePathForKey(pathname);
  const key = `${tier}:${clientIp}:${normalizedPath}`;

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.resetAt > windowMs) {
    return {
      allowed: true,
      remaining: limit,
      limit,
      reset: Math.floor((now + windowMs) / 1000),
      retryAfter: 0,
    };
  }

  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count < limit,
    remaining,
    limit,
    reset: Math.floor((bucket.resetAt + windowMs) / 1000),
    retryAfter: 0,
  };
}

/**
 * Reset all rate limit counters. Useful for testing.
 */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Get the number of active rate-limit buckets. Useful for testing/monitoring.
 */
export function getBucketCount(): number {
  return buckets.size;
}