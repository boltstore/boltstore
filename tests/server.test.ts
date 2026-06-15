/**
 * Tests for the Boltstore HTTP server.
 *
 * @module tests/server
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/server";

const TEST_PORT = 9876;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = createServer({ port: TEST_PORT });
});

afterAll(() => {
  server.stop();
});

describe("Server startup", () => {
  test("server is running", () => {
    expect(server).toBeDefined();
    expect(server.port).toBe(TEST_PORT);
  });
});

describe("GET /api/health", () => {
  test("returns 200 with status ok", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe("ok");
    expect(body.data.version).toBe("1.0.0");
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
    expect(body.data.timestamp).toBeDefined();
  });

  test("health check does not include error field", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    const body = await response.json();
    expect(body.error).toBeUndefined();
  });
});

describe("404 handling", () => {
  test("unknown route returns 404", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/unknown`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("unknown method returns 404", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});

describe("CORS headers", () => {
  test("includes CORS headers on response", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      headers: { Origin: "http://example.com" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://example.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeTruthy();
  });

  test("handles OPTIONS preflight", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://example.com");
  });

  test("allows any origin by default", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/api/health`, {
      headers: { Origin: "https://random-origin.com" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://random-origin.com");
  });
});