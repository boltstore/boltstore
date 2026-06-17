import { DatabasePool } from "../db/pool";
import type { User } from "./types";
import { bootstrapAuthTables } from "./tables";
import { validateEmail, validatePassword } from "./validation";
import { hashPassword } from "./password";
import { now } from "./jwt";
import { generateSecureId } from "@boltstore/utils";
import { markPasswordSet } from "../admin/oauth";

/**
 * Create an admin user in the system database.
 * Only callable from the CLI — creates with source="cli".
 */
export async function createAdminUser(
  pool: DatabasePool,
  email: string,
  password: string,
  name?: string
): Promise<User> {
  validateEmail(email);
  validatePassword(password);

  bootstrapAuthTables(pool);

  const passwordHash = await hashPassword(password);
  const id = generateUserId();
  const ts = now();

  return pool.writeTransaction(() => {
    const db = pool.write();

    const existing = db.query("SELECT 1 FROM _users WHERE email=?").get(email);
    if (existing) {
      throw Object.assign(
        new Error("A user with this email already exists."),
        { status: 409 }
      );
    }

    db.run(
      `INSERT INTO _users (id, email, name, password_hash, source, oauth_only, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), name ?? null, passwordHash, "cli", 0, ts, ts]
    );

    return { id, email, name, source: "cli", created_at: ts, updated_at: ts };
  });
}

function generateUserId(): string {
  return generateSecureId("usr");
}

export async function registerUser(
  pool: DatabasePool,
  email: string,
  password: string
): Promise<User> {
  validateEmail(email);
  validatePassword(password);

  bootstrapAuthTables(pool);

  const passwordHash = await hashPassword(password);
  const id = generateUserId();
  const ts = now();

  return pool.writeTransaction(() => {
    const db = pool.write();

    const existing = db.query("SELECT 1 FROM _users WHERE email=?").get(email);
    if (existing) {
      throw Object.assign(
        new Error("A user with this email already exists."),
        { status: 409 }
      );
    }

    db.run(
      `INSERT INTO _users (id, email, name, password_hash, source, oauth_only, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), null, passwordHash, "register", 0, ts, ts]
    );

    return { id, email, source: "register", created_at: ts, updated_at: ts };
  });
}

export function getUserById(
  pool: DatabasePool,
  userId: string
): User {
  bootstrapAuthTables(pool);
  const db = pool.read();

  const row = db
    .query("SELECT id, email, name, source, created_at, updated_at FROM _users WHERE id=?")
    .get(userId) as User | null;

  if (!row) {
    throw Object.assign(
      new Error(`User "${userId}" not found.`),
      { status: 404 }
    );
  }

  return row;
}

export async function updateProfile(
  pool: DatabasePool,
  userId: string,
  data: { email?: string; password?: string }
): Promise<User> {
  if (!data.email && !data.password) {
    throw Object.assign(
      new Error("At least one of 'email' or 'password' must be provided."),
      { status: 400 }
    );
  }

  bootstrapAuthTables(pool);

  const db = pool.read();
  const existing = db
    .query("SELECT id, email, name, source, created_at, updated_at FROM _users WHERE id=?")
    .get(userId) as User | null;

  if (!existing) {
    throw Object.assign(
      new Error(`User "${userId}" not found.`),
      { status: 404 }
    );
  }

  let passwordHash: string | undefined;
  if (data.password) {
    validatePassword(data.password);
    passwordHash = await hashPassword(data.password);
  }

  return pool.writeTransaction(() => {
    const writeDb = pool.write();
    const ts = now();

    if (data.email) {
      validateEmail(data.email);
      const normalizedEmail = data.email.toLowerCase();

      const dup = writeDb
        .query("SELECT 1 FROM _users WHERE email=? AND id!=?")
        .get(normalizedEmail, userId);
      if (dup) {
        throw Object.assign(
          new Error("A user with this email already exists."),
          { status: 409 }
        );
      }

      writeDb.run("UPDATE _users SET email=?, updated_at=? WHERE id=?", [normalizedEmail, ts, userId]);
    }

    if (passwordHash) {
      writeDb.run("UPDATE _users SET password_hash=?, oauth_only=0, updated_at=? WHERE id=?", [passwordHash, ts, userId]);
      markPasswordSet(pool, userId);
    } else if (data.email) {
      writeDb.run("UPDATE _users SET updated_at=? WHERE id=?", [ts, userId]);
    }

    const updated = writeDb
      .query("SELECT id, email, name, source, created_at, updated_at FROM _users WHERE id=?")
      .get(userId) as User;

    return updated;
  });
}
