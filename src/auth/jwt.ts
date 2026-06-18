import type { JwtPayload } from "./types";
import { generateSecureId } from "@boltstore/utils";

export function base64urlEncode(data: ArrayBuffer | Buffer): string {
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("base64url");
  }
  return data.toString("base64url");
}

export function signJwt(payload: Record<string, unknown>, secret: string, audience?: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const fullPayload: Record<string, unknown> = audience ? { ...payload, iss: "boltstore", aud: audience } : { ...payload, iss: "boltstore" };
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;

  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(signingInput);
  const signature = base64urlEncode(hasher.digest());

  return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string, audience?: string): JwtPayload {
  if (!token || typeof token !== "string") {
    throw Object.assign(new Error("Missing or invalid token."), { status: 401 });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw Object.assign(new Error("Invalid token format."), { status: 401 });
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
  } catch {
    throw Object.assign(new Error("Invalid token header."), { status: 401 });
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw Object.assign(new Error("Unsupported token algorithm or type."), { status: 401 });
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(signingInput);
  const expectedSig = base64urlEncode(hasher.digest());

  const expectedBuf = Buffer.from(expectedSig);
  const actualBuf = Buffer.from(signatureB64);
  if (expectedBuf.length !== actualBuf.length) {
    throw Object.assign(new Error("Invalid token signature."), { status: 401 });
  }
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw Object.assign(new Error("Invalid token signature."), { status: 401 });
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    throw Object.assign(new Error("Invalid token payload."), { status: 401 });
  }

  const n = unixNow();
  if (payload.exp && payload.exp < n - 60) {
    throw Object.assign(new Error("Token has expired."), { status: 401 });
  }

  if (!payload.sub || !payload.jti) {
    throw Object.assign(new Error("Invalid token claims."), { status: 401 });
  }

  if (audience && payload.aud !== audience) {
    throw Object.assign(new Error("Invalid token audience."), { status: 401 });
  }

  if (payload.iss !== "boltstore") {
    throw Object.assign(new Error("Invalid token issuer."), { status: 401 });
  }

  return payload;
}

export function generateJti(): string {
  return generateSecureId("tok");
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function now(): string {
  return new Date().toISOString();
}