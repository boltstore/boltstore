export type {
  WsMessageType,
  WsMessage,
  WsErrorPayload,
  WsConnectedPayload,
  SubscribeMessage,
  UnsubscribeMessage,
  RecordEvent,
} from "@boltstore/utils";

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
