import type { RecordEvent, Subscription } from "./types";
import { getSubscriptionsForCollection, getSubscriptionsForRecord } from "./subscription";
import { getConnectionById } from "./connection";
import { broadcastSseEvent } from "./sse";
import { applyRLS, toRLSContext } from "../rls";
import { toBindings } from "../db/cast";
import type { DatabasePool } from "../db/pool";

const wsByConnectionId = new Map<string, WebSocket>();

export function registerWsForBroadcast(connectionId: string, ws: WebSocket): void {
  wsByConnectionId.set(connectionId, ws);
}

export function unregisterWsForBroadcast(connectionId: string): void {
  wsByConnectionId.delete(connectionId);
}

function subscriberCanSeeRecord(
  pool: DatabasePool,
  collection: string,
  record: Record<string, unknown>,
  connectionId: string
): boolean {
  const conn = getConnectionById(connectionId);
  if (!conn) return false;
  if (conn.isAdmin) return true;

  const rlsCtx = conn.userId && conn.email ? { userId: conn.userId, email: conn.email } : null;
  if (!rlsCtx) return true;

  const rls = applyRLS(pool, collection, "read", rlsCtx);
  if (!rls) return true;

  const recordId = record.id as string;
  if (!recordId) return true;

  const db = pool.read();
  const sql = `SELECT 1 FROM "${collection}" WHERE id=? AND ${rls.whereClause}`;
  const row = db.query(sql).get(recordId, ...toBindings(rls.params));
  return !!row;
}

export function broadcastEvent(event: RecordEvent, pool?: DatabasePool): void {
  const { database, collection, record } = event;
  const recordId = record.id as string | undefined;

  const subs = recordId
    ? getSubscriptionsForRecord(database, collection, recordId)
    : getSubscriptionsForCollection(database, collection);

  const sent = new Set<string>();
  for (const sub of subs) {
    if (sent.has(sub.connectionId)) continue;
    sent.add(sub.connectionId);

    if (sub.filter && !matchesFilter(record, sub.filter)) continue;

    if (pool && !subscriberCanSeeRecord(pool, collection, record, sub.connectionId)) continue;

    const ws = wsByConnectionId.get(sub.connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;

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
