/**
 * Trusted proxy helper for Boltstore.
 *
 * @module boltstore/middleware/proxy
 */

/** Check whether the immediate connection IP is a trusted proxy. */
export function isTrustedProxy(remoteAddress: string, trusted: string[]): boolean {
  if (trusted.length === 0) return false;
  if (trusted.includes("*")) return true;
  return trusted.includes(remoteAddress) || trusted.includes("127.0.0.1") && remoteAddress === "127.0.0.1";
}

/** Resolve the client IP from request headers, respecting trusted proxies. */
export function resolveClientIp(
  request: Request,
  trustedProxies: string[],
  remoteAddress?: string
): string {
  const remote = remoteAddress || "127.0.0.1";
  if (!isTrustedProxy(remote, trustedProxies)) {
    return remote;
  }

  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("X-Real-IP");
  if (realIp) return realIp.trim();

  return remote;
}
