import { describe, expect, test } from "bun:test";
import { generateToken, generateId, sha256Hex, timingSafeEqual } from "../src/crypto-utils";

describe("crypto-utils", () => {
  describe("generateToken", () => {
    test("generates token of requested length", () => {
      const token = generateToken(32);
      expect(token.length).toBe(32);
    });

    test("generates unique tokens", () => {
      const t1 = generateToken(32);
      const t2 = generateToken(32);
      expect(t1).not.toBe(t2);
    });

    test("uses only base64url characters", () => {
      const token = generateToken(100);
      expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    test("generates tokens of various lengths", () => {
      expect(generateToken(1).length).toBe(1);
      expect(generateToken(64).length).toBe(64);
      expect(generateToken(128).length).toBe(128);
    });
  });

  describe("generateId", () => {
    test("generates prefixed ID", () => {
      const id = generateId("sess_");
      expect(id.startsWith("sess_")).toBe(true);
      expect(id.length).toBeGreaterThan(5);
    });

    test("generates unique IDs", () => {
      const id1 = generateId("adm_");
      const id2 = generateId("adm_");
      expect(id1).not.toBe(id2);
    });

    test("uses custom length", () => {
      const id = generateId("pre_", 10);
      expect(id.length).toBe(4 + 10);
    });
  });

  describe("sha256Hex", () => {
    test("produces 64-char hex string", async () => {
      const hash = await sha256Hex("hello");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test("is deterministic", async () => {
      const h1 = await sha256Hex("test");
      const h2 = await sha256Hex("test");
      expect(h1).toBe(h2);
    });

    test("different inputs produce different hashes", async () => {
      const h1 = await sha256Hex("hello");
      const h2 = await sha256Hex("world");
      expect(h1).not.toBe(h2);
    });
  });

  describe("timingSafeEqual", () => {
    test("equal strings return true", () => {
      expect(timingSafeEqual("hello", "hello")).toBe(true);
      expect(timingSafeEqual("", "")).toBe(true);
      expect(timingSafeEqual("a", "a")).toBe(true);
    });

    test("different strings return false", () => {
      expect(timingSafeEqual("hello", "world")).toBe(false);
      expect(timingSafeEqual("hello", "hell")).toBe(false);
      expect(timingSafeEqual("a", "b")).toBe(false);
    });

    test("different lengths return false", () => {
      expect(timingSafeEqual("hello", "helloo")).toBe(false);
      expect(timingSafeEqual("", "a")).toBe(false);
    });
  });
});
