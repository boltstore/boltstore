export type WsMessageType =
  | "ping"
  | "pong"
  | "error"
  | "connected";

export interface WsMessage {
  type: WsMessageType;
  [key: string]: unknown;
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

export interface WsConnectedPayload {
  connectionId: string;
}

export interface ConnectionInfo {
  connectionId: string;
  userId?: string;
  email?: string;
  database?: string;
  isAdmin: boolean;
  connectedAt: number;
  remoteAddress?: string;
}

export interface WsUpgradeData {
  connectionId: string;
  userId?: string;
  email?: string;
  database?: string;
  isAdmin: boolean;
  remoteAddress?: string;
}
