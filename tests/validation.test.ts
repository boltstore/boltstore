import { describe, expect, test } from "bun:test";
import {
  isValidDbName,
  isValidIdentifier,
  validateColumnDefault,
} from "../src/validation";

describe("Validation helpers", () => {
  describe("isValidDbName", () => {
    test("valid names", () => {
      expect(isValidDbName("myapp")).toBe(true);
      expect(isValidDbName("my-app")).toBe(true);
      expect(isValidDbName("my_app")).toBe(true);
      expect(isValidDbName("myapp123")).toBe(true);
      expect(isValidDbName("a")).toBe(true);
      expect(isValidDbName("1test")).toBe(true);
    });

    test("invalid names", () => {
      expect(isValidDbName("")).toBe(false);
      expect(isValidDbName("-app")).toBe(false);
      expect(isValidDbName("_app")).toBe(false);
      expect(isValidDbName("MyApp")).toBe(false);
      expect(isValidDbName("my app")).toBe(false);
      expect(isValidDbName("my.app")).toBe(false);
      expect(isValidDbName("my/app")).toBe(false);
      expect(isValidDbName("..")).toBe(false);
    });
  });

  describe("isValidIdentifier", () => {
    test("valid identifiers", () => {
      expect(isValidIdentifier("users")).toBe(true);
      expect(isValidIdentifier("Users")).toBe(true);
      expect(isValidIdentifier("_users")).toBe(true);
      expect(isValidIdentifier("user_name")).toBe(true);
      expect(isValidIdentifier("user123")).toBe(true);
      expect(isValidIdentifier("a")).toBe(true);
    });

    test("invalid identifiers", () => {
      expect(isValidIdentifier("")).toBe(false);
      expect(isValidIdentifier("123abc")).toBe(false);
      expect(isValidIdentifier("user name")).toBe(false);
      expect(isValidIdentifier("user-name")).toBe(false);
      expect(isValidIdentifier("user.name")).toBe(false);
      expect(isValidIdentifier("")).toBe(false);
    });

    test("max length 64", () => {
      expect(isValidIdentifier("a".repeat(64))).toBe(true);
      expect(isValidIdentifier("a".repeat(65))).toBe(false);
    });
  });

  describe("validateColumnDefault", () => {
    test("safe defaults pass", () => {
      expect(validateColumnDefault("0")).toBeNull();
      expect(validateColumnDefault("'hello'")).toBeNull();
      expect(validateColumnDefault("42")).toBeNull();
      expect(validateColumnDefault("datetime('now')")).toBeNull();
      expect(validateColumnDefault("current_timestamp")).toBeNull();
    });

    test("forbidden characters return error", () => {
      expect(validateColumnDefault("0; DROP TABLE x")).not.toBeNull();
      expect(validateColumnDefault("1 -- comment")).not.toBeNull();
      expect(validateColumnDefault("/* comment */ 1")).not.toBeNull();
    });
  });
});
