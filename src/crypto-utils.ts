/**
 * Secure random token and ID generation, plus hashing helpers.
 *
 * Uses crypto.getRandomValues with rejection sampling to avoid modulo bias,
 * and crypto.subtle for SHA-256 hashing.
 */

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function sampleUniform(max: number): number {
  const cutoff = 256 - (256 % max);
  let b: number;
  do {
    b = crypto.getRandomValues(new Uint8Array(1))[0];
  } while (b >= cutoff);
  return b % max;
}

/**
 * Generate a random token of the given length using base64url alphabet (64 chars, no modulo bias).
 */
export function generateToken(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE64URL_CHARS[sampleUniform(64)];
  }
  return out;
}

/**
 * Generate a prefixed ID (e.g. "adm_", "sess_", "ssn_") with a random base64url suffix.
 */
export function generateId(prefix: string, length = 24): string {
  return prefix + generateToken(length);
}

/**
 * SHA-256 hash a string and return the hex digest.
 */
export async function sha256Hex(input: string): Promise<string> {
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashed)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison. Returns true if the strings are equal.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}