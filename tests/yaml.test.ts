/**
 * Tests for the minimal YAML parser and config auto-detection.
 *
 * @module tests/yaml
 */

import { describe, expect, test } from "bun:test";
import { parseYaml } from "../src/yaml";

describe("YAML parser", () => {
  test("parses simple key-value pairs", () => {
    const result = parseYaml("port: 8080\ndatabasePath: ./data");
    expect(result.port).toBe(8080);
    expect(result.databasePath).toBe("./data");
  });

  test("parses string values", () => {
    const result = parseYaml('jwtSecret: "my-secret-key"');
    expect(result.jwtSecret).toBe("my-secret-key");
  });

  test("parses integer values", () => {
    const result = parseYaml("rateLimitPublic: 100");
    expect(result.rateLimitPublic).toBe(100);
  });

  test("parses boolean values", () => {
    const result = parseYaml("enabled: true\ndisabled: false");
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
  });

  test("parses null values", () => {
    const result = parseYaml("empty: null\nnone: ~");
    expect(result.empty).toBeNull();
    expect(result.none).toBeNull();
  });

  test("parses array values", () => {
    const result = parseYaml(`corsMethods:
  - GET
  - POST
  - PATCH
  - DELETE
  - OPTIONS`);
    const arr = result.corsMethods as string[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toEqual(["GET", "POST", "PATCH", "DELETE", "OPTIONS"]);
  });

  test("ignores comments", () => {
    const result = parseYaml("# This is a comment\nport: 3000\n# Another comment\ndatabasePath: /data");
    expect(result.port).toBe(3000);
    expect(result.databasePath).toBe("/data");
  });

  test("skips blank lines", () => {
    const result = parseYaml("\n\nport: 8080\n\n\ndatabasePath: ./data\n\n");
    expect(result.port).toBe(8080);
    expect(result.databasePath).toBe("./data");
  });

  test("parses float values", () => {
    const result = parseYaml("version: 1.5");
    expect(result.version).toBe(1.5);
  });

  test("parses single-quoted strings", () => {
    const result = parseYaml("name: 'hello world'");
    expect(result.name).toBe("hello world");
  });
});