import { describe, expect, test, beforeAll, afterAll } from "bun:test";

// Mock localStorage for bun test environment
const store: Record<string, string> = {};
beforeAll(() => {
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
});
afterAll(() => {
  delete (globalThis as any).localStorage;
});

import { saveSession, clearSession, hasSession } from "../src/api/client";

describe("Admin API client", () => {
  test("saveSession stores token", () => {
    saveSession("test-token");
    expect(hasSession()).toBe(true);
  });

  test("clearSession removes token", () => {
    saveSession("test-token");
    clearSession();
    expect(hasSession()).toBe(false);
  });

  test("hasSession returns false when no token", () => {
    clearSession();
    expect(hasSession()).toBe(false);
  });
});
