import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { checkRateLimit, getRateLimitStatus, resetRateLimits, stopRateLimitCleanup, DEFAULT_RATE_LIMIT_CONFIG } from "../../src/middleware/rate-limit";

const CONFIG = { ...DEFAULT_RATE_LIMIT_CONFIG, windowSeconds: 2 };

beforeEach(() => {
  resetRateLimits();
});

afterEach(() => {
  stopRateLimitCleanup();
});

describe("checkRateLimit", () => {
  test("allows requests within limit", () => {
    const config = { ...CONFIG, public: 5 };
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit("192.168.1.1", "/api/health", "public", config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - i - 1);
      expect(result.limit).toBe(5);
    }
  });

  test("blocks requests exceeding limit", () => {
    const config = { ...CONFIG, public: 2 };
    checkRateLimit("10.0.0.1", "/api/health", "public", config);
    checkRateLimit("10.0.0.1", "/api/health", "public", config);

    const result = checkRateLimit("10.0.0.1", "/api/health", "public", config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test("different endpoints have independent limits", () => {
    const config = { ...CONFIG, public: 1 };

    // Max out /api/health
    checkRateLimit("1.1.1.1", "/api/health", "public", config);
    const healthResult = checkRateLimit("1.1.1.1", "/api/health", "public", config);
    expect(healthResult.allowed).toBe(false);

    // /api/login should still have its own allowance
    const loginResult = checkRateLimit("1.1.1.1", "/api/login", "public", config);
    expect(loginResult.allowed).toBe(true);
  });

  test("different IPs have independent limits", () => {
    const config = { ...CONFIG, public: 1 };

    checkRateLimit("192.168.1.1", "/api/health", "public", config);
    const blocked = checkRateLimit("192.168.1.1", "/api/health", "public", config);
    expect(blocked.allowed).toBe(false);

    const allowed = checkRateLimit("192.168.1.2", "/api/health", "public", config);
    expect(allowed.allowed).toBe(true);
  });

  test("different tiers have different limits", () => {
    const config = { ...CONFIG, public: 2, auth: 5, admin: 3 };

    // Public gets 2, auth gets 5
    for (let i = 0; i < 2; i++) {
      expect(checkRateLimit("10.0.0.1", "/api/health", "public", config).allowed).toBe(true);
    }
    expect(checkRateLimit("10.0.0.1", "/api/health", "public", config).allowed).toBe(false);

    // Same IP, different tier (auth path) gets 5
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("10.0.0.1", "/api/collections", "auth", config).allowed).toBe(true);
    }
    expect(checkRateLimit("10.0.0.1", "/api/collections", "auth", config).allowed).toBe(false);
  });

  test("window resets after windowSeconds", async () => {
    const config = { ...CONFIG, public: 1, windowSeconds: 1 };

    checkRateLimit("1.1.1.1", "/test", "public", config);
    const blocked = checkRateLimit("1.1.1.1", "/test", "public", config);
    expect(blocked.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 1100));

    const fresh = checkRateLimit("1.1.1.1", "/test", "public", config);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(0);
  }, 5000);

  test("normalizes trailing slashes", () => {
    const config = { ...CONFIG, public: 1 };

    checkRateLimit("1.1.1.1", "/api/test/", "public", config);
    const result = checkRateLimit("1.1.1.1", "/api/test", "public", config);
    expect(result.allowed).toBe(false); // Should share the same bucket
  });

  test("reset timestamp is in the future", () => {
    const config = { ...CONFIG, public: 100, windowSeconds: 60 };
    const result = checkRateLimit("1.1.1.1", "/test", "public", config);
    const now = Math.floor(Date.now() / 1000);
    expect(result.reset).toBeGreaterThan(now);
    expect(result.reset).toBeLessThanOrEqual(now + 60);
  });

  test("retryAfter is 0 when allowed", () => {
    const config = { ...CONFIG, public: 100 };
    const result = checkRateLimit("1.1.1.1", "/test", "public", config);
    expect(result.retryAfter).toBe(0);
  });

  test("uses auth tier limit when auth endpoint is hit", () => {
    const config = { ...CONFIG, auth: 3, public: 10 };

    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit("10.0.0.1", "/api/something", "auth", config);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(3);
    }
    const blocked = checkRateLimit("10.0.0.1", "/api/something", "auth", config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(3);
  });

  test("uses admin tier limit when admin endpoint is hit", () => {
    const config = { ...CONFIG, admin: 2, auth: 100 };

    for (let i = 0; i < 2; i++) {
      const result = checkRateLimit("10.0.0.1", "/api/admin/collections", "admin", config);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(2);
    }
    const blocked = checkRateLimit("10.0.0.1", "/api/admin/collections", "admin", config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(2);
  });
});

describe("getRateLimitStatus", () => {
  test("returns full allowance when no requests made", () => {
    const config = { ...CONFIG, public: 5 };
    const status = getRateLimitStatus("1.1.1.1", "/fresh", "public", config);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(5);
    expect(status.limit).toBe(5);
  });

  test("reflects consumed requests without incrementing", () => {
    const config = { ...CONFIG, public: 3 };

    checkRateLimit("1.1.1.1", "/test", "public", config);
    checkRateLimit("1.1.1.1", "/test", "public", config);

    const status = getRateLimitStatus("1.1.1.1", "/test", "public", config);
    expect(status.remaining).toBe(1);
    expect(status.allowed).toBe(true);

    // Status check should NOT have incremented the counter
    const afterStatus = checkRateLimit("1.1.1.1", "/test", "public", config);
    expect(afterStatus.remaining).toBe(0);
    expect(afterStatus.allowed).toBe(true);
  });
});

describe("resetRateLimits", () => {
  test("clears all buckets", () => {
    const config = { ...CONFIG, public: 1 };

    checkRateLimit("1.1.1.1", "/test", "public", config);
    const blocked = checkRateLimit("1.1.1.1", "/test", "public", config);
    expect(blocked.allowed).toBe(false);

    resetRateLimits();

    const fresh = checkRateLimit("1.1.1.1", "/test", "public", config);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(0);
  });
});

describe("DEFAULT_RATE_LIMIT_CONFIG", () => {
  test("has sensible defaults", () => {
    expect(DEFAULT_RATE_LIMIT_CONFIG.public).toBe(100);
    expect(DEFAULT_RATE_LIMIT_CONFIG.auth).toBe(1000);
    expect(DEFAULT_RATE_LIMIT_CONFIG.admin).toBe(500);
    expect(DEFAULT_RATE_LIMIT_CONFIG.windowSeconds).toBe(60);
  });
});