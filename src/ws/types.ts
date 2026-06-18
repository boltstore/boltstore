export type WsMessageType =
  | "ping"
  | "pong"
  | "error"
  | "connected"
  | "subscribe"
  | "unsubscribe"
  | "event";

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

export interface SubscribeMessage {
  type: "subscribe";
  collection?: string;
  recordId?: string;
  filter?: Record<string, unknown>;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  subscriptionId: string;
}

export interface RecordEvent {
  type: "event";
  event: "create" | "update" | "delete";
  collection: string;
  database: string;
  record: Record<string, unknown>;
  previous?: Record<string, unknown>;
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

export interface Subscription {
  id: string;
  connectionId: string;
  database: string;
  collection?: string;
  recordId?: string;
  filter?: Record<string, unknown>;
  createdAt: number;
}
