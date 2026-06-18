import type { Subscription, SubscribeMessage } from "./types";
import { generateSecureId } from "@boltstore/utils";

const subscriptions = new Map<string, Subscription>();
const connectionSubscriptions = new Map<string, Set<string>>();

export function createSubscriptionId(): string {
  return generateSecureId("sub");
}

export function addSubscription(
  connectionId: string,
  database: string,
  msg: SubscribeMessage
): Subscription {
  const id = createSubscriptionId();
  const sub: Subscription = {
    id,
    connectionId,
    database,
    collection: msg.collection,
    recordId: msg.recordId,
    filter: msg.filter,
    createdAt: Date.now(),
  };
  subscriptions.set(id, sub);

  let connSubs = connectionSubscriptions.get(connectionId);
  if (!connSubs) {
    connSubs = new Set();
    connectionSubscriptions.set(connectionId, connSubs);
  }
  connSubs.add(id);

  return sub;
}

export function removeSubscription(subscriptionId: string): boolean {
  const sub = subscriptions.get(subscriptionId);
  if (!sub) return false;
  subscriptions.delete(subscriptionId);
  const connSubs = connectionSubscriptions.get(sub.connectionId);
  if (connSubs) {
    connSubs.delete(subscriptionId);
    if (connSubs.size === 0) {
      connectionSubscriptions.delete(sub.connectionId);
    }
  }
  return true;
}

export function removeAllSubscriptions(connectionId: string): number {
  const connSubs = connectionSubscriptions.get(connectionId);
  if (!connSubs) return 0;
  for (const subId of connSubs) {
    subscriptions.delete(subId);
  }
  connectionSubscriptions.delete(connectionId);
  return connSubs.size;
}

export function getSubscription(id: string): Subscription | undefined {
  return subscriptions.get(id);
}

export function getSubscriptionsForConnection(connectionId: string): Subscription[] {
  const connSubs = connectionSubscriptions.get(connectionId);
  if (!connSubs) return [];
  return Array.from(connSubs)
    .map((id) => subscriptions.get(id))
    .filter((s): s is Subscription => s !== undefined);
}

export function getSubscriptionsForCollection(
  database: string,
  collection: string
): Subscription[] {
  const result: Subscription[] = [];
  for (const sub of subscriptions.values()) {
    if (sub.database !== database) continue;
    if (sub.collection && sub.collection !== collection) continue;
    if (sub.recordId) continue;
    result.push(sub);
  }
  return result;
}

export function getSubscriptionsForRecord(
  database: string,
  collection: string,
  recordId: string
): Subscription[] {
  const result: Subscription[] = [];
  for (const sub of subscriptions.values()) {
    if (sub.database !== database) continue;
    if (sub.collection && sub.collection !== collection) continue;
    if (sub.recordId && sub.recordId !== recordId) continue;
    result.push(sub);
  }
  return result;
}

export function getSubscriptionCount(): number {
  return subscriptions.size;
}
