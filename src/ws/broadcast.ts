import type { RecordEvent, Subscription } from "./types";
import { getSubscriptionsForCollection, getSubscriptionsForRecord } from "./subscription";
import { getConnectionById } from "./connection";

const wsByConnectionId = new Map<string, WebSocket>();

export function registerWsForBroadcast(connectionId: string, ws: WebSocket): void {
  wsByConnectionId.set(connectionId, ws);
}

export function unregisterWsForBroadcast(connectionId: string): void {
  wsByConnectionId.delete(connectionId);
}

export function broadcastEvent(event: RecordEvent): void {
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

    const ws = wsByConnectionId.get(sub.connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;

    try {
      ws.send(JSON.stringify(event));
    } catch {
      // Send failure — skip
    }
  }
}

function matchesFilter(record: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (record[key] !== value) return false;
  }
  return true;
}
