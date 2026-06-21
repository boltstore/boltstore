import type { Server, ServerWebSocket } from "bun";
import type { WsUpgradeData, WsMessage, SubscribeMessage, UnsubscribeMessage, RecordEvent } from "./types";
import { createConnectionId, registerConnection, unregisterConnection, getConnectionById } from "./connection";
import { addSubscription, removeSubscription, removeAllSubscriptions } from "./subscription";
import { registerWsForBroadcast, unregisterWsForBroadcast } from "./broadcast";
import { authenticateWsUpgrade } from "./auth";
import { DatabaseManager } from "../db/manager";
import type { AuthConfig } from "../auth";
import { apiKeyAllows } from "../admin/api-keys";
import { listChangesSince } from "./changes";
import { getRecord } from "../records/crud";
import type { AuthContext } from "../middleware/auth";
import { logger } from "../logger";

export interface WsHandlerConfig {
  manager?: DatabaseManager;
  auth?: AuthConfig;
}

const PING_RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_PINGS_PER_WINDOW = 5;
const MAX_REPLAY_CHANGES = 1000;

function isSystemCollection(name?: string): boolean {
  return !!name && name.startsWith("_");
}

function canSubscribe(data: WsUpgradeData, database: string, collection?: string): boolean {
  if (!collection) return true;
  if (isSystemCollection(collection) && !data.isAdmin) return false;
  if (data.apiKey) {
    return apiKeyAllows(
      { keyId: data.apiKey.keyId, name: "", permissions: data.apiKey.permissions },
      database,
      "read",
      collection,
    );
  }
  return true;
}

export function createWebSocketHandler(config: WsHandlerConfig) {
  const { manager, auth: authConfig = {} } = config;

  const pingCounts = new Map<string, { count: number; windowStart: number }>();

  return {
    open(ws: ServerWebSocket<WsUpgradeData | undefined>): void {
      const data = ws.data;
      if (!data) {
        ws.close(4001, "Upgrade data missing");
        return;
      }

      registerConnection(ws as unknown as WebSocket, data);
      registerWsForBroadcast(data.connectionId, ws as unknown as WebSocket);
      pingCounts.set(data.connectionId, { count: 0, windowStart: Date.now() });

      logger.info(`WebSocket connected: ${data.connectionId}`, {
        request_id: "ws",
        method: "WS",
        path: `/ws`,
        status: 101,
        duration_ms: 0,
        ws_connection_id: data.connectionId,
        ws_user_id: data.userId,
        ws_database: data.database,
      });

      ws.send(JSON.stringify({
        type: "connected",
        connectionId: data.connectionId,
      }));
    },

    message(ws: ServerWebSocket<WsUpgradeData | undefined>, raw: string | Buffer): void {
      let msg: WsMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "INVALID_MESSAGE", message: "Expected JSON message." }));
        return;
      }

      const data = ws.data;
      const database = data?.database;

      // Rate-limit pings per connection to prevent resource exhaustion
      if (msg.type === "ping" && data?.connectionId) {
        const pingState = pingCounts.get(data.connectionId);
        if (pingState) {
          const now = Date.now();
          if (now - pingState.windowStart > PING_RATE_LIMIT_WINDOW_MS) {
            pingState.count = 1;
            pingState.windowStart = now;
          } else {
            pingState.count++;
            if (pingState.count > MAX_PINGS_PER_WINDOW) {
              ws.close(4001, "Ping rate limit exceeded");
              return;
            }
          }
        }
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // Handle auth message (token sent after connection instead of in URL)
      if (msg.type === "auth" && database && !data?.userId) {
        const token = (msg as Record<string, unknown>).token as string | undefined;
        if (token && manager && authConfig) {
          const fakeUrl = new URL(`http://localhost/ws?token=${encodeURIComponent(token)}&db=${encodeURIComponent(database)}`);
          authenticateWsUpgrade(fakeUrl, manager, authConfig).then((result) => {
            if (!(result instanceof Response) && ws.data) {
              ws.data.userId = result.userId;
              ws.data.email = result.email;
              ws.data.isAdmin = result.isAdmin;
              if (result.apiKey) ws.data.apiKey = result.apiKey;
              ws.send(JSON.stringify({ type: "authenticated", userId: result.userId }));
            } else {
              ws.send(JSON.stringify({ type: "error", code: "AUTH_FAILED", message: "Authentication failed." }));
            }
          }).catch(() => {
            ws.send(JSON.stringify({ type: "error", code: "AUTH_FAILED", message: "Authentication failed." }));
          });
        } else {
          ws.send(JSON.stringify({ type: "error", code: "AUTH_FAILED", message: "Authentication failed." }));
        }
        return;
      }

      switch (msg.type) {
      case "subscribe": {
        const subMsg = msg as unknown as SubscribeMessage;
        if (!database) {
          ws.send(JSON.stringify({ type: "error", code: "NO_DATABASE", message: "No database associated with this connection. Reconnect with ?database=." }));
          break;
        }
        if (!canSubscribe(data!, database, subMsg.collection)) {
          ws.send(JSON.stringify({
            type: "error",
            code: "FORBIDDEN",
            message: `Not allowed to subscribe to collection "${subMsg.collection ?? ""}".`,
          }));
          break;
        }
        const sub = addSubscription(data!.connectionId, database, subMsg);
        const response: Record<string, unknown> = { type: "subscribed", subscriptionId: sub.id };
        if (subMsg.localId) response.localId = subMsg.localId;
        ws.send(JSON.stringify(response));

        // Replay missed changes since lastSeq
        if (subMsg.lastSeq != null && manager && database && subMsg.collection) {
          try {
            const pool = manager.get(database);
            const replayResult = listChangesSince(pool, {
              cursor: subMsg.lastSeq,
              collection: subMsg.collection,
              limit: MAX_REPLAY_CHANGES,
            });

            for (const change of replayResult.changes) {
              if (!data) continue;

              // RLS filter: skip changes the subscriber can't read
              if (!data.isAdmin && change.recordId && change.event !== "delete") {
                try {
                  const replayAuth: AuthContext = {
                    principalId: data.userId || data.connectionId || "",
                    email: data.email,
                    isApiKey: !!data.apiKey,
                    isAdmin: data.isAdmin,
                  };
                  getRecord(pool, change.collection, change.recordId, replayAuth);
                } catch {
                  continue;
                }
              }

              const replayEvent: RecordEvent = {
                type: "event",
                event: change.event as "create" | "update" | "delete",
                collection: change.collection,
                database,
                record: change.record,
                previous: change.previous ?? undefined,
                seq: change.seq,
              };
              ws.send(JSON.stringify(replayEvent));
            }
          } catch (err) {
            logger.warn("Failed to replay changes on subscribe", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        break;
      }

      case "unsubscribe": {
        const unsubMsg = msg as unknown as UnsubscribeMessage;
        const removed = removeSubscription(unsubMsg.subscriptionId);
        if (removed) {
          ws.send(JSON.stringify({ type: "unsubscribed", subscriptionId: unsubMsg.subscriptionId }));
        } else {
          ws.send(JSON.stringify({ type: "error", code: "SUBSCRIPTION_NOT_FOUND", message: `Subscription "${unsubMsg.subscriptionId}" not found.` }));
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: "error", code: "UNKNOWN_TYPE", message: `Unknown message type: ${msg.type}` }));
        break;
      }
    },

    close(ws: ServerWebSocket<WsUpgradeData | undefined>, code: number, reason: string): void {
      const data = ws.data;
      const connectionId = data?.connectionId;

      if (connectionId) {
        removeAllSubscriptions(connectionId);
        unregisterWsForBroadcast(connectionId);
        pingCounts.delete(connectionId);
      }
      unregisterConnection(ws as unknown as WebSocket);

      logger.info(`WebSocket disconnected: ${connectionId || "unknown"} (code=${code})`, {
        request_id: "ws",
        method: "WS",
        path: `/ws`,
        status: 100,
        duration_ms: 0,
        ws_connection_id: connectionId,
        ws_close_code: code,
        ws_close_reason: reason,
      });
    },

    drain(ws: ServerWebSocket<WsUpgradeData | undefined>): void {
      // Backpressure — no-op for now
    },

    ping(ws: ServerWebSocket<WsUpgradeData | undefined>): void {
      ws.send(JSON.stringify({ type: "pong" }));
    },

    pong(ws: ServerWebSocket<WsUpgradeData | undefined>): void {
      // Reset keepalive — no-op for now
    },
  };
}

export async function handleWsUpgrade(
  request: Request,
  server: Server<WsUpgradeData>,
  manager: DatabaseManager | undefined,
  authConfig: AuthConfig
): Promise<Response | undefined> {
  const url = new URL(request.url);

  const authResult = await authenticateWsUpgrade(url, manager, authConfig, request);
  if (authResult instanceof Response) {
    return authResult;
  }

  const connectionId = createConnectionId();
  const remoteAddress = (request as unknown as { remoteAddress?: string }).remoteAddress;

  const upgraded = server.upgrade(request, {
    data: {
      connectionId,
      userId: authResult.userId,
      email: authResult.email,
      database: authResult.database,
      isAdmin: authResult.isAdmin,
      apiKey: authResult.apiKey,
      remoteAddress,
    } satisfies WsUpgradeData,
  });

  if (!upgraded) {
    return new Response("WebSocket upgrade failed.", { status: 500 });
  }

  return undefined;
}
