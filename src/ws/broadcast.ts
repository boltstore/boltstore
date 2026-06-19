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

const rlsCache = new Map<string, { whereClause: string; params: unknown[] } | null>();

function getCachedRls(pool: DatabasePool, collection: string, userId: string, email: string): { whereClause: string; params: unknown[] } | null {
  const cacheKey = `${collection}:${userId}:${email}`;
  let rls = rlsCache.get(cacheKey);
  if (rls === undefined) {
    const rlsCtx = { userId, email };
    rls = applyRLS(pool, collection, "read", rlsCtx) || null;
    rlsCache.set(cacheKey, rls);
  }
  return rls;
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
        // No delete events for non-admins on RLS collections
        continue;
      } else if (conn.userId && conn.email) {
        const rls = getCachedRls(pool, collection, conn.userId, conn.email);
        if (rls) {
          const db = pool.read();
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

/** Clear the RLS cache. Useful for testing. */
export function clearRlsCache(): void {
  rlsCache.clear();
}
