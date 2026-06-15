/**
 * Tests for the structured JSON logger.
 *
 * @module tests/logger
 */

import { describe, expect, test } from "bun:test";
import { generateRequestId } from "../src/logger";

describe("Logger", () => {
  test("generateRequestId returns unique IDs", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });

  test("generateRequestId starts with req-", () => {
    const id = generateRequestId();
    expect(id.startsWith("req-")).toBe(true);
  });

  test("generateRequestId has sufficient length", () => {
    const id = generateRequestId();
    expect(id.length).toBeGreaterThan(15);
  });
});