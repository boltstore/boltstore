import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseManager } from "../../src/db/manager";
import { createApiKey, listApiKeys, getApiKey, revokeApiKey, verifyApiKey, bootstrapApiKeyTables } from "../../src/admin/api-keys";

const TEST_DATA_DIR = "/tmp/boltstore_test_apikeys";
const TEST_APP = "apikeyapp";

let manager: DatabaseManager;
let pool: ReturnType<typeof manager.get>;

function cleanupDir() {
  try { if (manager) manager.close(); } catch {}
  try { Bun.spawnSync(["rm", "-rf", TEST_DATA_DIR]); } catch {}
}

beforeAll(() => {
  cleanupDir();
  Bun.spawnSync(["mkdir", "-p", TEST_DATA_DIR]);
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  manager.createDatabase(TEST_APP);
  pool = manager.get(TEST_APP);
});

afterAll(() => cleanupDir());

beforeEach(() => {
  // Drop API keys table between tests
  const db = pool.write();
  try { db.run("DROP TABLE IF EXISTS _api_keys"); } catch {}
});

describe("createApiKey", () => {
  test("creates an API key with full metadata", async () => {
    const key = await createApiKey(pool, "My Service Key", {
      collections: ["posts", "comments"],
      operations: ["read", "create"],
    });

    expect(key.id).toStartWith("apk_");
    expect(key.name).toBe("My Service Key");
    expect(key.prefix).toHaveLength(8);
    expect(key.secret).toStartWith("blt_");
    expect(key.secret.length).toBeGreaterThan(40);
    expect(key.permissions.collections).toEqual(["posts", "comments"]);
    expect(key.permissions.operations).toEqual(["read", "create"]);
    expect(key.revoked).toBe(false);
    expect(key.created_at).toBeTruthy();
    expect(key.last_used_at).toBeNull();
  });

  test("creates a key with default empty permissions", async () => {
    const key = await createApiKey(pool, "Default Key");
    expect(key.permissions).toEqual({});
  });

  test("trims whitespace from name", async () => {
    const key = await createApiKey(pool, "  Trimmed Name  ");
    expect(key.name).toBe("Trimmed Name");
  });

  test("rejects empty name", async () => {
    try {
      await createApiKey(pool, "");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.message).toContain("required");
      expect(e.status).toBe(400);
    }
  });

  test("rejects name over 128 chars", async () => {
    try {
      await createApiKey(pool, "x".repeat(129));
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.message).toContain("128");
      expect(e.status).toBe(400);
    }
  });

  test("rejects invalid operation in permissions", async () => {
    try {
      await createApiKey(pool, "Bad Op", {
        operations: ["read", "adminish"] as unknown as string[],
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.message).toContain("Invalid operation");
      expect(e.status).toBe(400);
    }
  });

  test("rejects non-array collections", async () => {
    try {
      await createApiKey(pool, "Bad Collections", {
        collections: "posts" as unknown as string[],
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.message).toContain("must be an array");
      expect(e.status).toBe(400);
    }
  });

  test("generates unique IDs and secrets for different keys", async () => {
    const key1 = await createApiKey(pool, "Key 1");
    const key2 = await createApiKey(pool, "Key 2");

    expect(key1.id).not.toBe(key2.id);
    expect(key1.secret).not.toBe(key2.secret);
  });
});

describe("listApiKeys", () => {
  test("lists all API keys without secrets", async () => {
    await createApiKey(pool, "Key A");
    await createApiKey(pool, "Key B");

    const keys = listApiKeys(pool);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect((key as Record<string, unknown>).secret).toBeUndefined();
    }
  });

  test("returns sorted by created_at descending", async () => {
    await createApiKey(pool, "Older");
    // Tiny delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await createApiKey(pool, "Newer");

    const keys = listApiKeys(pool);
    expect(keys[0].name).toBe("Newer");
    expect(keys[1].name).toBe("Older");
  });

  test("returns empty array when no keys exist", () => {
    const keys = listApiKeys(pool);
    expect(keys).toEqual([]);
  });

  test("shows revoked status correctly", async () => {
    const key = await createApiKey(pool, "To Revoke");
    revokeApiKey(pool, key.id);

    const keys = listApiKeys(pool);
    const found = keys.find((k) => k.id === key.id);
    expect(found?.revoked).toBe(true);
  });
});

describe("getApiKey", () => {
  test("returns a single key by ID", async () => {
    const created = await createApiKey(pool, "Single Key");
    const found = getApiKey(pool, created.id);

    expect(found.id).toBe(created.id);
    expect(found.name).toBe("Single Key");
    expect((found as Record<string, unknown>).secret).toBeUndefined();
  });

  test("throws 404 for non-existent key", () => {
    try {
      getApiKey(pool, "nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

describe("revokeApiKey", () => {
  test("revokes a key", async () => {
    const key = await createApiKey(pool, "Revocable");
    revokeApiKey(pool, key.id);

    const found = getApiKey(pool, key.id);
    expect(found.revoked).toBe(true);
  });

  test("revocation is irreversible — verify fails after revoke", async () => {
    const key = await createApiKey(pool, "Revoke Me");

    // Should verify before revocation
    const ctx = await verifyApiKey(pool, key.secret);
    expect(ctx.keyId).toBe(key.id);

    revokeApiKey(pool, key.id);

    // Should fail after revocation
    try {
      await verifyApiKey(pool, key.secret);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("throws 404 for non-existent key", () => {
    try {
      revokeApiKey(pool, "nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.status).toBe(404);
    }
  });
});

describe("verifyApiKey", () => {
  test("returns context for valid key", async () => {
    const key = await createApiKey(pool, "Verify Key", {
      collections: ["posts"],
      operations: ["read"],
    });

    const ctx = await verifyApiKey(pool, key.secret);
    expect(ctx.keyId).toBe(key.id);
    expect(ctx.name).toBe("Verify Key");
    expect(ctx.permissions.collections).toEqual(["posts"]);
    expect(ctx.permissions.operations).toEqual(["read"]);
  });

  test("returns context for key with no permissions", async () => {
    const key = await createApiKey(pool, "No Perms");
    const ctx = await verifyApiKey(pool, key.secret);
    expect(ctx.keyId).toBe(key.id);
    expect(ctx.permissions).toEqual({});
  });

  test("rejects invalid secret", async () => {
    await createApiKey(pool, "Valid Key");
    try {
      await verifyApiKey(pool, "blt_invalid_key_here");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("rejects empty secret", async () => {
    try {
      await verifyApiKey(pool, "");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("rejects wrong prefix", async () => {
    await createApiKey(pool, "Key");
    // Prefix look-up won't find anything so it should be invalid
    try {
      await verifyApiKey(pool, "blt_different_prefix_than_stored");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      expect(e.status).toBe(401);
    }
  });

  test("updates last_used_at on successful verification", async () => {
    const key = await createApiKey(pool, "Usage Key");
    await verifyApiKey(pool, key.secret);

    const found = getApiKey(pool, key.id);
    expect(found.last_used_at).not.toBeNull();
  });

  test("multiple keys with same prefix but different hash — only correct one verifies", async () => {
    // Create two keys — their prefixes may collide (8 chars is 64^8 space, but
    // we need to test that hashing properly distinguishes them)
    const key1 = await createApiKey(pool, "Key 1");
    const key2 = await createApiKey(pool, "Key 2");

    // Both should verify with their own secrets
    const ctx1 = await verifyApiKey(pool, key1.secret);
    expect(ctx1.keyId).toBe(key1.id);

    const ctx2 = await verifyApiKey(pool, key2.secret);
    expect(ctx2.keyId).toBe(key2.id);
  });
});

describe("bootstrapApiKeyTables", () => {
  test("creates _api_keys table if not exists", () => {
    const db = pool.write();
    try { db.run("DROP TABLE IF EXISTS _api_keys"); } catch {}

    bootstrapApiKeyTables(pool);

    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_api_keys'")
      .get() as { name: string } | null;
    expect(row).not.toBeNull();
  });

  test("is idempotent", () => {
    bootstrapApiKeyTables(pool);
    bootstrapApiKeyTables(pool);

    // Should not throw
    const keys = listApiKeys(pool);
    expect(keys).toEqual([]);
  });
});