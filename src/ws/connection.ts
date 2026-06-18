import type { ConnectionInfo, WsUpgradeData } from "./types";
import { generateSecureId } from "@boltstore/utils";

const connections = new Map<string, ConnectionInfo>();
const wsToConnectionId = new WeakMap<WebSocket, string>();

export function createConnectionId(): string {
  return generateSecureId("ws_");
}

export function registerConnection(ws: WebSocket, data: WsUpgradeData): ConnectionInfo {
  const info: ConnectionInfo = {
    connectionId: data.connectionId,
    userId: data.userId,
    email: data.email,
    database: data.database,
    isAdmin: data.isAdmin,
    connectedAt: Date.now(),
    remoteAddress: data.remoteAddress,
  };
  connections.set(data.connectionId, info);
  wsToConnectionId.set(ws, data.connectionId);
  return info;
}

export function unregisterConnection(ws: WebSocket): void {
  const connectionId = wsToConnectionId.get(ws);
  if (connectionId) {
    connections.delete(connectionId);
    wsToConnectionId.delete(ws);
  }
}

export function getConnection(ws: WebSocket): ConnectionInfo | undefined {
  const connectionId = wsToConnectionId.get(ws);
  if (!connectionId) return undefined;
  return connections.get(connectionId);
}

export function getConnectionById(connectionId: string): ConnectionInfo | undefined {
  return connections.get(connectionId);
}

export function getConnectionCount(): number {
  return connections.size;
}

export function listConnections(): ConnectionInfo[] {
  return Array.from(connections.values());
}

export function getConnectionsForDatabase(database: string): ConnectionInfo[] {
  return Array.from(connections.values()).filter((c) => c.database === database);
}

export function getConnectionsForUser(userId: string): ConnectionInfo[] {
  return Array.from(connections.values()).filter((c) => c.userId === userId);
}
