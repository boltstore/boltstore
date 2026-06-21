import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";

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

export function registerActivityRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/activity", async (req) => {
    if (!isAdminRequest(req, manager)) return jsonResponse({ data: [], meta: { total: 0 } });
    const rows = manager.getMetaPool().read().query(
      "SELECT id, action, database_name, target, details, ip, created_at FROM _activity_log ORDER BY created_at DESC LIMIT 100"
    ).all();
    return jsonResponse({ data: rows, meta: { total: rows.length } });
  });
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
