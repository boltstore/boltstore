/**
 * Tests for the URL router.
 *
 * @module tests/router
 */

import { describe, expect, test } from "bun:test";
import { Router } from "../src/router";

describe("Router", () => {
  test("matches static GET route", () => {
    const router = new Router();
    router.get("/api/health", () => new Response("ok"));
    const result = router.match("GET", "/api/health");
    expect(result).not.toBeNull();
  });

  test("matches route with params", () => {
    const router = new Router();
    router.get("/api/collections/:collection/records/:id", () => new Response("ok"));
    const result = router.match("GET", "/api/collections/posts/records/123");
    expect(result).not.toBeNull();
    expect(result!.params.collection).toBe("posts");
    expect(result!.params.id).toBe("123");
  });

  test("returns null for unmatched route", () => {
    const router = new Router();
    router.get("/api/health", () => new Response("ok"));
    const result = router.match("GET", "/api/unknown");
    expect(result).toBeNull();
  });

  test("returns null for wrong method", () => {
    const router = new Router();
    router.get("/api/health", () => new Response("ok"));
    const result = router.match("POST", "/api/health");
    expect(result).toBeNull();
  });

  test("POST route works", () => {
    const router = new Router();
    router.post("/api/data", () => new Response("created"));
    const result = router.match("POST", "/api/data");
    expect(result).not.toBeNull();
  });

  test("PATCH route works", () => {
    const router = new Router();
    router.patch("/api/data/:id", () => new Response("updated"));
    const result = router.match("PATCH", "/api/data/42");
    expect(result).not.toBeNull();
    expect(result!.params.id).toBe("42");
  });

  test("DELETE route works", () => {
    const router = new Router();
    router.delete("/api/data/:id", () => new Response("deleted"));
    const result = router.match("DELETE", "/api/data/99");
    expect(result).not.toBeNull();
  });

  test("handles encoded params", () => {
    const router = new Router();
    router.get("/api/items/:name", () => new Response("ok"));
    const result = router.match("GET", "/api/items/hello%20world");
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe("hello world");
  });
});