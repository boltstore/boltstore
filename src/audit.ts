/**
 * Structured audit logging for auth and admin events.
 *
 * Audit events are always written to stderr as structured JSON with
 * `audit: true`. When a `DatabasePool` is supplied, they are also persisted
 * to the `_audit_log` table for later review.
 *
 * @module boltstore/audit
 */

import { DatabasePool } from "./db/pool";
import logger from "./logger";

/** Categories of audit events. */
export type AuditEventType =
  | "auth.login"
  | "auth.register"
  | "auth.logout"
  | "auth.refresh"
  | "auth.profile_update"
  | "auth.password_change"
  | "api_key.create"
  | "api_key.revoke"
  | "api_key.use"
  | "database.create"
  | "database.delete"
  | "collection.create"
  | "collection.update"
  | "collection.delete"
  | "collection.rls_update"
  | "index.create"
  | "index.drop"
  | "view.create"
  | "view.drop"
  | "migration.up"
  | "migration.down"
  | "backup.create"
  | "backup.restore"
  | "import"
  | "export"
  | "raw_sql.write"
  | "transaction.execute";

/** A single audit event. */
export interface AuditEvent {
  type: AuditEventType;
  principalId?: string;
  principalType?: "user" | "api_key";
  database?: string;
  collection?: string;
  action?: string;
  target?: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

/** Bootstrap the audit log table in a database. */
export function bootstrapAuditTables(pool: DatabasePool): void {
  const db = pool.write();
  db.run(`
    CREATE TABLE IF NOT EXISTS _audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      principal_id TEXT,
      principal_type TEXT,
      database TEXT,
      collection TEXT,
      action TEXT,
      target TEXT,
      ip TEXT,
      user_agent TEXT,
      success INTEGER NOT NULL,
      details_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON _audit_log(created_at)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_type ON _audit_log(type)
  `);
}

/**
 * Log an audit event to stderr and, if a pool is provided, to `_audit_log`.
 */
export function logAuditEvent(event: AuditEvent, pool?: DatabasePool): void {
  const entry: Record<string, unknown> = {
    audit: true,
    type: event.type,
    principal_id: event.principalId,
    principal_type: event.principalType,
    database: event.database,
    collection: event.collection,
    action: event.action,
    target: event.target,
    ip: event.ip,
    user_agent: event.userAgent,
    success: event.success,
    details: event.details,
    error: event.error,
  };

  logger.info(`audit: ${event.type}`, entry);

  if (pool) {
    try {
      bootstrapAuditTables(pool);
      const db = pool.write();
      db.run(
        `INSERT INTO _audit_log
         (type, principal_id, principal_type, database, collection, action, target, ip, user_agent, success, details_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.type,
          event.principalId ?? null,
          event.principalType ?? null,
          event.database ?? null,
          event.collection ?? null,
          event.action ?? null,
          event.target ?? null,
          event.ip ?? null,
          event.userAgent ?? null,
          event.success ? 1 : 0,
          event.details ? JSON.stringify(event.details) : null,
          event.error ?? null,
        ]
      );
    } catch {
      // Persistence failures must not break the request.
    }
  }
}

/** Sanitize a raw SQL string for audit logging: truncate and strip newlines. */
export function sanitizeSqlForAudit(sql: string, maxLength = 500): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength) + "...";
}
