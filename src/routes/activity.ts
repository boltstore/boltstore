import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse } from "../server";
import { isAdminRequest } from "../middleware/auth";

export interface ActivityEvent {
  action: string;
  admin_id?: string;
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

export function getClientIp(request: Request): string | undefined {
  // Cloudflare — most reliable when present
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;

  // X-Forwarded-For — first IP is the original client
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  // X-Real-IP — used by nginx and some reverse proxies
  const real = request.headers.get("x-real-ip");
  if (real) return real;

  return undefined;
}

export function getAdminId(request: Request, manager: DatabaseManager): string | undefined {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return undefined;
  const token = auth.slice(7).trim();
  if (!token) return undefined;
  try {
    const row = manager.getMetaPool().read()
      .query("SELECT admin_id FROM _sessions WHERE token = ?")
      .get(token) as { admin_id: string } | null;
    return row?.admin_id;
  } catch {
    return undefined;
  }
}

export function registerActivityRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/activity", async (req) => {
    if (!isAdminRequest(req, manager)) return jsonResponse({ data: [], meta: { total: 0 } });
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const total = (manager.getMetaPool().read().query("SELECT COUNT(*) as c FROM _activity_log").get() as any)?.c ?? 0;
    const rows = manager.getMetaPool().read().query(
      `SELECT a.id, a.admin_id, a.action, a.database_name, a.target, a.details, a.ip, a.created_at, adm.email as admin_email
       FROM _activity_log a
       LEFT JOIN _admins adm ON adm.id = a.admin_id
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
    return jsonResponse({ data: rows, meta: { total, limit, offset } });
  });
}

export function logActivity(manager: DatabaseManager, event: ActivityEvent): void {
  try {
    manager.getMetaPool().write().run(
      "INSERT INTO _activity_log (id, admin_id, action, database_name, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [generateId(), event.admin_id ?? null, event.action, event.database_name ?? null, event.target ?? null, event.details ? JSON.stringify(event.details) : null, event.ip ?? null]
    );
  } catch {
    // Activity log is best-effort — never crash the request
  }
}
