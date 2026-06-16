/**
 * Rate limiting middleware for Boltstore.
 *
 * Uses a sliding-window counter approach with per-IP, per-endpoint,
 * per-tier tracking. All state is in-memory (no SQLite dependency) for
 * speed — resets on server restart.
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
 * Key format: `${tier}:${clientIp}:${pathname}`
 * This allows per-endpoint rate limits that don't interfere with each other.
 */
const buckets = new Map<string, WindowBucket>();

/**
 * Periodically clean up expired buckets to prevent memory leaks.
 * Runs every 60 seconds, removes buckets older than 2× the window.
 */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(maxWindowSeconds: number): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = maxWindowSeconds * 2000; // 2× the longest window
    for (const [key, bucket] of buckets) {
      if (now - bucket.resetAt > maxAge) {
        buckets.delete(key);
      }
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
 * @returns A result indicating whether the request is allowed.
 */
export function checkRateLimit(
  clientIp: string,
  pathname: string,
  tier: RateLimitTier,
  config: RateLimitConfig
): RateLimitResult {
  startCleanup(config.windowSeconds);

  const limit = config[tier] ?? config.public;
  const windowMs = config.windowSeconds * 1000;

  // Normalize: strip trailing slashes and query strings from path key
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const key = `${tier}:${clientIp}:${normalizedPath}`;

  const now = Date.now();
  let bucket = buckets.get(key);

  // If no bucket exists, or the window has expired, reset
  if (!bucket || now - bucket.resetAt > windowMs) {
    bucket = { resetAt: now, count: 0 };
    buckets.set(key, bucket);
  }

  bucket.count++;

  const remaining = Math.max(0, limit - bucket.count);
  const allowed = bucket.count <= limit;
  const reset = Math.floor((bucket.resetAt + windowMs) / 1000);
  const retryAfter = allowed ? 0 : Math.ceil((bucket.resetAt + windowMs - now) / 1000);

  return {
    allowed,
    remaining,
    limit,
    reset,
    retryAfter,
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

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
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