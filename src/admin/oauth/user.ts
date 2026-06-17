import { DatabasePool } from "../../db/pool";
import { bootstrapAuthTables, generateSecureId, generateRandomPassword, type User } from "../../auth";

export async function findOrCreateOAuthUser(
  pool: DatabasePool,
  profile: { id: string; email: string; name?: string }
): Promise<User & { oauth_only: number; password_set: number }> {
  bootstrapAuthTables(pool);
  const db = pool.read();

  const existing = db
    .query("SELECT id, email, role, oauth_only, password_set, created_at, updated_at FROM _users WHERE email=?")
    .get(profile.email) as (User & { oauth_only?: number; password_set?: number }) | null;

  if (existing) {
    const passwordSet = existing.password_set ?? (existing.oauth_only === 1 ? 0 : 1);
    if (existing.oauth_only === 1 && passwordSet === 0) {
      return { ...existing, oauth_only: 1, password_set: 0 };
    }
    return { ...existing, oauth_only: existing.oauth_only ?? 0, password_set: passwordSet };
  }

  const id = generateSecureId("usr");
  const ts = new Date().toISOString();
  const randomPassword = await generateRandomPassword();

  return pool.writeTransaction(() => {
    const writeDb = pool.write();
    writeDb.run(
      "INSERT INTO _users (id, email, password_hash, role, oauth_only, password_set, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, profile.email, randomPassword, "user", 1, 0, ts, ts]
    );

    return { id, email: profile.email, role: "user" as const, oauth_only: 1, password_set: 0, created_at: ts, updated_at: ts };
  });
}

export function markPasswordSet(pool: DatabasePool, userId: string): void {
  bootstrapAuthTables(pool);
  pool.write().run("UPDATE _users SET password_set=1, oauth_only=0 WHERE id=?", [userId]);
}
