import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { isAdminRequest, resolveAdminSession } from "../middleware/auth";
import { generateId } from "../crypto-utils";
import { logger } from "../logger";

export interface ActivityEvent {
  action: string;
  admin_id?: string;
  database_name?: string;
  target?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

let configuredTrustedProxies: string[] = [];

export function setTrustedProxies(proxies: string[]): void {
  configuredTrustedProxies = proxies;
}

function isTrustedProxy(ip: string): boolean {
  if (configuredTrustedProxies.length === 0) return false;
  return configuredTrustedProxies.includes(ip);
}

export function getClientIp(request: Request): string | undefined {
  const directIp = request.headers.get("x-boltstore-direct-ip");

  // If we know the direct connection IP, only trust forwarded headers
  // when the direct connection is from a trusted proxy.
  const trustForwarded = !directIp || isTrustedProxy(directIp);

  if (trustForwarded) {
    const cf = request.headers.get("cf-connecting-ip");
    if (cf) return cf;

    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }

    const real = request.headers.get("x-real-ip");
    if (real) return real;
  }

  // Fall back to the direct connection IP if available
  return directIp ?? undefined;
}

export async function getAdminId(request: Request, manager: DatabaseManager): Promise<string | undefined> {
  const session = await resolveAdminSession(request, manager);
  return session?.adminId;
}

export function registerActivityRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/activity", async (req) => {
    if (!(await isAdminRequest(req, manager))) return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const total = (manager.getMetaPool().read().query("SELECT COUNT(*) as c FROM _activity_log").get() as { c?: number })?.c ?? 0;
    const rows = manager.getMetaPool().read().query(
      `SELECT a.id, a.admin_id, a.action, a.database_name, a.target, a.details, a.ip, a.created_at, adm.email as admin_email
       FROM _activity_log a
       LEFT JOIN _admins adm ON adm.id = a.admin_id
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
    return jsonResponse({ data: rows, meta: { total, limit, offset } });
  });
}

function sanitizeDetails(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  const SECRET_KEYS = ["key", "token_hash", "password", "secret"];
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    sanitized[k] = SECRET_KEYS.some(sk => k.toLowerCase().includes(sk)) ? "***" : v;
  }
  return JSON.stringify(sanitized);
}

export function logActivity(manager: DatabaseManager, event: ActivityEvent): void {
  try {
    manager.getMetaPool().write().run(
      "INSERT INTO _activity_log (id, admin_id, action, database_name, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [generateId("act_", 16), event.admin_id ?? null, event.action, event.database_name ?? null, event.target ?? null, sanitizeDetails(event.details), event.ip ?? null]
    );
  } catch (err) {
    logger.warn("Failed to write activity log", { action: event.action, error: err instanceof Error ? err.message : String(err) });
  }
}