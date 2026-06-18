export type {
  WsMessageType,
  WsMessage,
  WsErrorPayload,
  WsConnectedPayload,
  SubscribeMessage,
  UnsubscribeMessage,
  RecordEvent,
} from "@boltstore/utils";

import type { ApiKeyPermissions } from "../admin/api-keys";

export interface ApiKeyConnectionContext {
  keyId: string;
  permissions: ApiKeyPermissions;
}

export interface ConnectionInfo {
  connectionId: string;
  userId?: string;
  email?: string;
  database?: string;
  isAdmin: boolean;
  apiKey?: ApiKeyConnectionContext;
  connectedAt: number;
  remoteAddress?: string;
}

export interface WsUpgradeData {
  connectionId: string;
  userId?: string;
  email?: string;
  database?: string;
  isAdmin: boolean;
  apiKey?: ApiKeyConnectionContext;
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
