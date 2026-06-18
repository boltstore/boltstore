/**
 * Trusted proxy helper for Boltstore.
 *
 * @module boltstore/middleware/proxy
 */

/** Check whether the immediate connection IP is a trusted proxy. Supports exact IPs and CIDR notation. */
export function isTrustedProxy(remoteAddress: string, trusted: string[]): boolean {
  if (trusted.length === 0) return false;
  if (trusted.includes("*")) return true;
  if (trusted.includes(remoteAddress)) return true;
  if (trusted.includes("127.0.0.1") && remoteAddress === "127.0.0.1") return true;
  for (const entry of trusted) {
    if (entry.includes("/")) {
      const [cidrIp, bitsStr] = entry.split("/");
      const bits = parseInt(bitsStr, 10);
      if (bits > 0 && bits <= 32 && matchCidr(remoteAddress, cidrIp, bits)) return true;
    }
  }
  return false;
}

function ipToUint32(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function matchCidr(ip: string, cidrIp: string, bits: number): boolean {
  const ipNum = ipToUint32(ip);
  const cidrNum = ipToUint32(cidrIp);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
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
