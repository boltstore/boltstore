const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface AttemptBucket {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, AttemptBucket>();

const CLEANUP_INTERVAL = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of attempts) {
      if (now >= bucket.resetAt) attempts.delete(key);
    }
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
  const key = `login:${ip}`;
  let bucket = attempts.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    attempts.set(key, bucket);
    startCleanup();
  }

  bucket.count++;
  const remaining = bucket.resetAt - now;

  if (bucket.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: remaining };
  }

  return { allowed: true, retryAfterMs: 0 };
}
