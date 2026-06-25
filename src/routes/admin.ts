import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { logActivity, getClientIp, getAdminId } from "./activity";
import { generateId, sha256Hex, timingSafeEqual } from "../crypto-utils";
import { logger } from "../logger";
import { checkLoginThrottle } from "../middleware/throttle";
import { resolveAdminSession } from "../middleware/auth";

const SESSION_TTL_HOURS = 24 * 7; // 7 days

export function registerAdminRoutes(router: Router, manager: DatabaseManager, adminKey?: string): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/admin/status", () => {
    const count = (metaPool.read().query("SELECT COUNT(*) as c FROM _admins").get() as { c?: number })?.c ?? 0;
    return jsonResponse({ data: { hasAdmins: count > 0 } });
  });

  router.post("/api/admin/setup", async (req) => {
    if ((req.headers.get("content-type") || "").toLowerCase().indexOf("application/json") === -1) {
      return errorResponse("VALIDATION", "Content-Type must be application/json.", 415);
    }
    const throttle = checkLoginThrottle(getClientIp(req));
    if (!throttle.allowed) {
      return errorResponse("RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil(throttle.retryAfterMs / 1000)} seconds.`, 429);
    }

    const body = await parseJsonBody<{ email?: string; password?: string }>(req); if (body instanceof Response) return body;
    if (!body.email || !body.password) {
      return errorResponse("VALIDATION", "Email and password are required.", 400);
    }
    if (body.email.length < 3) return errorResponse("VALIDATION", "Email must be at least 3 characters.", 400);
    if (body.password.length < 8) return errorResponse("VALIDATION", "Password must be at least 8 characters.", 400);

    // Check bootstrap key validity before entering the transaction (non-DB side effect)
    const existing = metaPool.read().query("SELECT COUNT(*) as c FROM _admins").get() as { c?: number };
    const hasAdmins = (existing.c ?? 0) > 0;

    if (hasAdmins) {
      const auth = req.headers.get("Authorization");
      const provided = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!adminKey || !provided || !timingSafeEqual(provided, adminKey)) {
        return errorResponse("UNAUTHORIZED", "Bootstrap key required to create additional admins.", 401);
      }
    }

    // Hash password outside transaction (Bun.password.hash is async)
    const passwordHash = await Bun.password.hash(body.password, { algorithm: "bcrypt", cost: 10 });
    const id = generateId("adm_");

    // Atomically check bootstrap consumption + insert admin + mark consumed
    try {
      return metaPool.writeTransaction(() => {
        if (hasAdmins) {
          const result = metaPool.write().run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('bootstrap_consumed', 'true')");
          if (result.changes === 0) {
            return errorResponse("FORBIDDEN", "Bootstrap key has been consumed. Additional admins require an existing admin session.", 403);
          }
        }

        const dup = metaPool.write().query("SELECT 1 FROM _admins WHERE email = ?").get(body.email!) as { c?: number } | null;
        if (dup) {
          throw new Error("DUPLICATE_EMAIL");
        }

        metaPool.write().run("INSERT INTO _admins (id, email, password_hash) VALUES (?, ?, ?)", [id, body.email!, passwordHash]);

        const ip = getClientIp(req);
        logActivity(manager, { action: "admin.create", admin_id: id, details: { email: body.email!, bootstrap: hasAdmins }, ip });
        return jsonResponse({ data: { id, email: body.email! } }, 201);
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "DUPLICATE_EMAIL") {
        return errorResponse("CONFLICT", "Email already exists.", 409);
      }
      throw err;
    }
  });

  router.post("/api/admin/login", async (req) => {
    if ((req.headers.get("content-type") || "").toLowerCase().indexOf("application/json") === -1) {
      return errorResponse("VALIDATION", "Content-Type must be application/json.", 415);
    }
    const throttle = checkLoginThrottle(getClientIp(req));
    if (!throttle.allowed) {
      return errorResponse("RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil(throttle.retryAfterMs / 1000)} seconds.`, 429);
    }

    const body = await parseJsonBody<{ email?: string; password?: string }>(req); if (body instanceof Response) return body;
    if (!body.email || !body.password) {
      return errorResponse("VALIDATION", "Email and password are required.", 400);
    }

    const row = metaPool.read().query("SELECT id, email, password_hash FROM _admins WHERE email = ?").get(body.email) as { id: string; email: string; password_hash: string } | null;
    if (!row) return errorResponse("UNAUTHORIZED", "Invalid email or password.", 401);

    const valid = await Bun.password.verify(body.password, row.password_hash);
    if (!valid) return errorResponse("UNAUTHORIZED", "Invalid email or password.", 401);

    // Generate a random session token; store only its hash
    const token = generateId("sess_", 48);
    const tokenHash = await sha256Hex(token);
    const sessId = generateId("ssn_");
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
    metaPool.write().run("INSERT INTO _sessions (id, admin_id, token_hash, expires_at) VALUES (?, ?, ?, ?)", [sessId, row.id, tokenHash, expiresAt]);

    logActivity(manager, { action: "admin.login", admin_id: row.id, details: { admin: row.email }, ip: getClientIp(req) });
    return jsonResponse({ data: { token, admin: { id: row.id, email: row.email } } });
  });

  router.get("/api/admin/me", async (req) => {
    const token = extractToken(req);
    if (!token) return errorResponse("UNAUTHORIZED", "Not authenticated.", 401);

    const tokenHash = await sha256Hex(token);
    const sessionRow = metaPool.read().query(`
      SELECT admin_id, expires_at FROM _sessions WHERE token_hash = ?
    `).get(tokenHash) as { admin_id: string; expires_at: string | null } | null;

    if (!sessionRow) return errorResponse("UNAUTHORIZED", "Invalid session.", 401);

    if (sessionRow.expires_at && sessionRow.expires_at <= new Date().toISOString()) {
      return errorResponse("UNAUTHORIZED", "Session expired. Please log in again.", 401);
    }

    const row = metaPool.read().query("SELECT id, email FROM _admins WHERE id = ?").get(sessionRow.admin_id) as { id: string; email: string } | null;
    if (!row) return errorResponse("UNAUTHORIZED", "Admin not found.", 401);
    return jsonResponse({ data: { id: row.id, email: row.email } });
  });

  router.post("/api/admin/logout", async (req) => {
    const token = extractToken(req);
    if (token) {
      const tokenHash = await sha256Hex(token);
      const row = metaPool.read().query("SELECT admin_id FROM _sessions WHERE token_hash = ?").get(tokenHash) as { admin_id: string } | null;
      metaPool.write().run("DELETE FROM _sessions WHERE token_hash = ?", [tokenHash]);
      if (row) {
        logActivity(manager, { action: "admin.logout", admin_id: row.admin_id, ip: getClientIp(req) });
      }
    }
    return jsonResponse({ data: { loggedOut: true } });
  });

  // Prune expired sessions (called on each admin request via this endpoint)
  router.post("/api/admin/sessions/prune", async (req) => {
    if (!(await import("../middleware/auth")).isAdminRequest(req, manager)) {
      return errorResponse("UNAUTHORIZED", "Admin access required.", 401);
    }
    try {
      const result = metaPool.write().run("DELETE FROM _sessions WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')");
      return jsonResponse({ data: { pruned: result.changes } });
    } catch (err) {
      logger.warn("Session prune failed", { error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ data: { pruned: 0 } });
    }
  });
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function setupSessionCleanup(manager: DatabaseManager): void {
  const metaPool = manager.getMetaPool();
  const clean = () => {
    try {
      const r = metaPool.write().run("DELETE FROM _sessions WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')");
      if (r.changes > 0) logger.info("Session cleanup", { pruned: r.changes });
    } catch (err) {
      logger.warn("Session cleanup failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  setInterval(clean, SESSION_CLEANUP_INTERVAL_MS);
  clean();
}