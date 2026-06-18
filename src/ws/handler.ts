import type { Server, ServerWebSocket } from "bun";
import type { WsUpgradeData, WsMessage } from "./types";
import { createConnectionId, registerConnection, unregisterConnection, getConnection } from "./connection";
import { authenticateWsUpgrade } from "./auth";
import { DatabaseManager } from "../db/manager";
import type { AuthConfig } from "../auth";
import { logger } from "../logger";

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export interface WsHandlerConfig {
  manager?: DatabaseManager;
  auth?: AuthConfig;
}

export function createWebSocketHandler(config: WsHandlerConfig) {
  const { manager, auth: authConfig = {} } = config;

  return {
    open(ws: ServerWebSocket<WsUpgradeData | undefined>): void {
      const data = ws.data;
      if (!data) {
        ws.close(4001, "Upgrade data missing");
        return;
      }

      registerConnection(ws as unknown as WebSocket, data);

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

      switch (msg.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      default:
        ws.send(JSON.stringify({ type: "error", code: "UNKNOWN_TYPE", message: `Unknown message type: ${msg.type}` }));
        break;
      }
    },

    close(ws: ServerWebSocket<WsUpgradeData | undefined>, code: number, reason: string): void {
      const data = ws.data;
      const connectionId = data?.connectionId;

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

  const authResult = await authenticateWsUpgrade(url, manager, authConfig);
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
      remoteAddress,
    } satisfies WsUpgradeData,
  });

  if (!upgraded) {
    return new Response("WebSocket upgrade failed.", { status: 500 });
  }

  return undefined;
}
