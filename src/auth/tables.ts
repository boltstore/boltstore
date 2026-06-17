import { DatabasePool } from "../db/pool";

export function bootstrapAuthTables(pool: DatabasePool): void {
  const db = pool.write();

  db.run(`
    CREATE TABLE IF NOT EXISTS _users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      oauth_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  try { db.run("ALTER TABLE _users ADD COLUMN oauth_only INTEGER NOT NULL DEFAULT 0"); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS _tokens (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_user_expires ON _tokens(user_id, expires_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_expires ON _tokens(expires_at)
  `);
}

let tokenCleanupIntervals: Map<DatabasePool, ReturnType<typeof setInterval>> = new Map();

export function startTokenCleanup(pool: DatabasePool, intervalMs = 5 * 60 * 1000): void {
  if (tokenCleanupIntervals.has(pool)) return;
  const interval = setInterval(() => {
    try {
      const db = pool.write();
      db.run("DELETE FROM _tokens WHERE expires_at < datetime('now') OR revoked = 1");
    } catch {
      // Ignore cleanup errors.
    }
  }, intervalMs);
  tokenCleanupIntervals.set(pool, interval);
}

export function stopTokenCleanup(pool?: DatabasePool): void {
  if (pool) {
    const interval = tokenCleanupIntervals.get(pool);
    if (interval) {
      clearInterval(interval);
      tokenCleanupIntervals.delete(pool);
    }
  } else {
    for (const interval of tokenCleanupIntervals.values()) {
      clearInterval(interval);
    }
    tokenCleanupIntervals.clear();
  }
}