import { DatabaseManager } from "../db/manager";

export interface ActivityEvent {
  action: string;
  database_name?: string;
  target?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 16; i++) id += chars[bytes[i] % chars.length];
  return "act_" + id;
}

export function logActivity(manager: DatabaseManager, event: ActivityEvent): void {
  try {
    manager.getMetaPool().write().run(
      "INSERT INTO _activity_log (id, action, database_name, target, details, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [generateId(), event.action, event.database_name ?? null, event.target ?? null, event.details ? JSON.stringify(event.details) : null, event.ip ?? null]
    );
  } catch {
    // Activity log is best-effort — never crash the request
  }
}
