const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface AttemptBucket {
  count: number;
  resetAt: number;
}

// Rate limit state is process-local (in-memory Map).
// In a multi-instance deployment behind a load balancer, each instance
// maintains independent counters. Use a Redis-backed rate limiter or
// consistent-hash load balancing for distributed deployments.
const attempts = new Map<string, AttemptBucket>();

const CLEANUP_INTERVAL = 60_000;
const MAX_MAP_SIZE = 50_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function pruneExpired(now: number): void {
  for (const [key, bucket] of attempts) {
    if (now >= bucket.resetAt) attempts.delete(key);
  }
}

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    pruneExpired(Date.now());
    if (attempts.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL);
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
}

export function checkLoginThrottle(ip: string | undefined): { allowed: boolean; retryAfterMs: number } {
  // Skip throttling when IP is unavailable (local/loopback/test requests).
  // Only throttle external requests with identifiable IPs.
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "unknown") {
    return { allowed: true, retryAfterMs: 0 };
  }

  const now = Date.now();
  if (attempts.size > MAX_MAP_SIZE) pruneExpired(now);
  const key = `login:${ip}`;
  let bucket = attempts.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    attempts.set(key, bucket);
    startCleanup();
    return { allowed: true, retryAfterMs: 0 };
  }

  bucket.count++;
  const remaining = bucket.resetAt - now;

  if (bucket.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: remaining };
  }

  return { allowed: true, retryAfterMs: 0 };
}

const API_KEY_WINDOW_MS = 60_000;
const MAX_API_KEY_ATTEMPTS = 20;

export function checkApiKeyThrottle(ip: string | undefined, databaseName: string): { allowed: boolean; retryAfterMs: number } {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "unknown") {
    return { allowed: true, retryAfterMs: 0 };
  }

  const now = Date.now();
  if (attempts.size > MAX_MAP_SIZE) pruneExpired(now);
  const key = `apikey:${ip}:${databaseName}`;
  let bucket = attempts.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + API_KEY_WINDOW_MS };
    attempts.set(key, bucket);
    startCleanup();
  }

  bucket.count++;
  const remaining = bucket.resetAt - now;

  if (bucket.count > MAX_API_KEY_ATTEMPTS) {
    return { allowed: false, retryAfterMs: remaining };
  }

  return { allowed: true, retryAfterMs: 0 };
}

// Data API endpoints (records, tables, query) are intentionally unthrottled.
// Boltstore is a server-to-server DBaaS — API keys are issued to developers,
// not end users. A per-IP throttle on data endpoints would harm legitimate
// backend workloads. Rate limiting for the data plane belongs at the reverse
// proxy or WAF layer if needed.
