import type { RecordEvent } from "./types";
import { getSubscriptionsForCollection, getSubscriptionsForRecord } from "./subscription";
import { getConnectionById } from "./connection";
import { broadcastSseEvent } from "./sse";
import { applyRLS } from "../rls";
import { toBindings } from "../db/cast";
import type { DatabasePool } from "../db/pool";
import { apiKeyAllows } from "../admin/api-keys";

const wsByConnectionId = new Map<string, WebSocket>();

export function registerWsForBroadcast(connectionId: string, ws: WebSocket): void {
  wsByConnectionId.set(connectionId, ws);
}

export function unregisterWsForBroadcast(connectionId: string): void {
  wsByConnectionId.delete(connectionId);
}

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
}

function connectionCanReadCollection(connectionId: string, database: string, collection: string): boolean {
  const conn = getConnectionById(connectionId);
  if (!conn) return false;
  if (isSystemCollection(collection) && !conn.isAdmin) return false;
  if (conn.apiKey) {
    return apiKeyAllows(
      { keyId: conn.apiKey.keyId, name: "", permissions: conn.apiKey.permissions },
      database,
      "read",
      collection,
    );
  }
  return true;
}

const rlsCache = new Map<string, { whereClause: string; params: unknown[]; rawRule: string } | null>();

function getCachedRls(pool: DatabasePool, collection: string, userId: string, email: string): { whereClause: string; params: unknown[]; rawRule: string } | null {
  const cacheKey = `${collection}:${userId}:${email}`;
  let cached = rlsCache.get(cacheKey);
  if (cached === undefined) {
    const rlsCtx = { userId, email };
    const rls = applyRLS(pool, collection, "read", rlsCtx);
    if (rls) {
      // Also fetch the raw rule with $userId/$email tokens for record-level matching
      const db = pool.read();
      const policyRow = db.query("SELECT read_rule FROM _collections WHERE name=?").get(collection) as { read_rule: string | null } | null;
      cached = { whereClause: rls.whereClause, params: rls.params, rawRule: policyRow?.read_rule || "" };
    } else {
      cached = null;
    }
    rlsCache.set(cacheKey, cached);
  }
  return cached;
}

function getRawRlsRule(pool: DatabasePool, collection: string): string {
  try {
    const db = pool.read();
    const row = db.query("SELECT read_rule FROM _collections WHERE name=?").get(collection) as { read_rule: string | null } | null;
    return row?.read_rule || "";
  } catch {
    return "";
  }
}

/**
 * Pre-filter subscribers before building per-subscriber SQL.
 * Returns just the candidate connectionIds that pass admin, collection, and API-key checks.
 */
function getCandidateSubscribers(
  subs: Array<{ connectionId: string; filter?: Record<string, unknown> }>,
  database: string,
  collection: string,
  record: Record<string, unknown>
): string[] {
  const sent = new Set<string>();
  const candidates: string[] = [];
  for (const sub of subs) {
    if (sent.has(sub.connectionId)) continue;
    sent.add(sub.connectionId);
    if (!connectionCanReadCollection(sub.connectionId, database, collection)) continue;
    if (sub.filter && !matchesFilter(record, sub.filter)) continue;
    candidates.push(sub.connectionId);
  }
  return candidates;
}

export function broadcastEvent(event: RecordEvent, pool?: DatabasePool): void {
  const { database, collection, record } = event;
  const recordId = record.id as string | undefined;

  // Cache the collection RLS presence once per broadcast — avoids re-querying per subscriber
  const hasRls = pool ? collectionHasRLS(pool, collection) : false;

  const subs = recordId
    ? [...getSubscriptionsForRecord(database, collection, recordId), ...getSubscriptionsForCollection(database, collection)]
    : getSubscriptionsForCollection(database, collection);

  const candidates = getCandidateSubscribers(subs, database, collection, record);

  for (const connId of candidates) {
    if (hasRls && pool && recordId) {
      const conn = getConnectionById(connId);
      if (!conn) continue;
      if (conn.isAdmin) {
        // Admin sees everything
      } else if (event.event === "delete") {
        // The record was deleted from the DB, so we cannot run a SQL query.
        // Instead, verify the subscriber's RLS access against the record data
        // that was captured before deletion.
        if (conn.userId && conn.email) {
          const rawRule = getRawRlsRule(pool, collection);
          if (rawRule && !recordSatisfiesRls(record as Record<string, unknown>, rawRule, conn.userId, conn.email)) continue;
        }
      } else if (conn.userId && conn.email) {
        const rls = getCachedRls(pool, collection, conn.userId, conn.email);
        if (rls) {
          // Use pool.write() here — when called from inside a transaction
          // (e.g. sync push), the write connection sees uncommitted rows
          // that read connections cannot.
          const db = pool.write();
          const sql = `SELECT 1 FROM "${collection}" WHERE id=? AND ${rls.whereClause}`;
          const row = db.query(sql).get(recordId, ...toBindings(rls.params));
          if (!row) continue;
        }
      }
    }

    const ws = wsByConnectionId.get(connId);
    if (!ws) continue;

    try {
      ws.send(JSON.stringify(event));
    } catch {
      // Send failure — skip
    }
  }

  broadcastSseEvent(event, pool);
}

function matchesFilter(record: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (record[key] !== value) return false;
  }
  return true;
}

function collectionHasRLS(pool: DatabasePool, collection: string): boolean {
  const db = pool.read();
  try {
    const row = db.query("SELECT read_rule FROM _collections WHERE name=?").get(collection) as { read_rule: string | null } | null;
    return !!row?.read_rule && row.read_rule.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * Check whether a record's fields match an RLS rule against a subscriber's identity.
 * Used for delete events where the record is gone from the DB but we still have the
 * record data that was fetched before deletion.
 *
 * Handles the common pattern `field = $userId` by comparing record[field] === userId.
 * For compound rules using AND, requires all conditions to match.
 */
function recordSatisfiesRls(record: Record<string, unknown>, rule: string, userId: string, email: string): boolean {
  if (!rule || rule.trim() === "") return true;
  
  // Split on AND (case-insensitive) to handle compound rules
  const parts = rule.split(/\s+AND\s+/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      // Recurse into parenthesized groups
      if (!recordSatisfiesRls(record, trimmed.slice(1, -1), userId, email)) return false;
      continue;
    }
    
    // Check for field = $userId pattern
    const userIdMatch = trimmed.match(/"?(\w+)"?\s*=\s*\$userId\b/i);
    if (userIdMatch) {
      const field = userIdMatch[1];
      if (record[field] !== userId) return false;
      continue;
    }
    
    // Check for field = $email pattern
    const emailMatch = trimmed.match(/"?(\w+)"?\s*=\s*\$email\b/i);
    if (emailMatch) {
      const field = emailMatch[1];
      if (record[field] !== email) return false;
      continue;
    }
    
    // Unknown pattern in rule — conservatively deny
    return false;
  }
  
  return true;
}

/** Clear the RLS cache. Useful for testing. */
export function clearRlsCache(): void {
  rlsCache.clear();
}
