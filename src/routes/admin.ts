import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse, parseJsonBody } from "../server";
import { logActivity, getClientIp, getAdminId } from "./activity";
import { generateId, sha256Hex, timingSafeEqual } from "../crypto-utils";
import { logger } from "../logger";

const SESSION_TTL_HOURS = 24 * 7; // 7 days

export function registerAdminRoutes(router: Router, manager: DatabaseManager, adminKey?: string): void {
  const metaPool = manager.getMetaPool();

  router.get("/api/admin/status", () => {
    const count = (metaPool.read().query("SELECT COUNT(*) as c FROM _admins").get() as { c?: number })?.c ?? 0;
    return jsonResponse({ data: { hasAdmins: count > 0 } });
  });

  router.post("/api/admin/setup", async (req) => {
    const body = await parseJsonBody<{ email?: string; password?: string }>(req); if (body instanceof Response) return body;
    if (!body.email || !body.password) {
      return errorResponse("VALIDATION", "Email and password are required.", 400);
    }
    if (body.email.length < 3) return errorResponse("VALIDATION", "Email must be at least 3 characters.", 400);
    if (body.password.length < 8) return errorResponse("VALIDATION", "Password must be at least 8 characters.", 400);

    const existing = metaPool.read().query("SELECT COUNT(*) as c FROM _admins").get() as { c?: number };
    const hasAdmins = (existing.c ?? 0) > 0;

    if (hasAdmins) {
      // If admins exist, require the bootstrap key (constant-time compare)
      const auth = req.headers.get("Authorization");
      const provided = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!adminKey || !provided || !timingSafeEqual(provided, adminKey)) {
        return errorResponse("UNAUTHORIZED", "Bootstrap key required to create additional admins.", 401);
      }
      // Check if bootstrap has already been consumed
      const consumed = metaPool.read().query("SELECT value FROM _meta WHERE key = 'bootstrap_consumed'").get() as { value?: string } | null;
      if (consumed?.value === "true") {
        return errorResponse("FORBIDDEN", "Bootstrap key has been consumed. Additional admins require an existing admin session.", 403);
      }
    }

    const dup = metaPool.read().query("SELECT 1 FROM _admins WHERE email = ?").get(body.email);
    if (dup) return errorResponse("CONFLICT", "Email already exists.", 409);

    const id = generateId("adm_");
    const passwordHash = await Bun.password.hash(body.password, { algorithm: "bcrypt", cost: 10 });
    metaPool.write().run("INSERT INTO _admins (id, email, password_hash) VALUES (?, ?, ?)", [id, body.email, passwordHash]);

    // Mark bootstrap as consumed after the first admin is created via bootstrap key
    if (hasAdmins) {
      metaPool.write().run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('bootstrap_consumed', 'true')");
    }

    logActivity(manager, { action: "admin.create", admin_id: id, details: { email: body.email, bootstrap: hasAdmins }, ip: getClientIp(req) });
    return jsonResponse({ data: { id, email: body.email } }, 201);
  });

  router.post("/api/admin/login", async (req) => {
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
    const row = metaPool.read().query(`
      SELECT a.id, a.email FROM _admins a
      JOIN _sessions s ON s.admin_id = a.id
      WHERE s.token_hash = ? AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
    `).get(tokenHash) as { id: string; email: string } | null;

    if (!row) return errorResponse("UNAUTHORIZED", "Invalid or expired session.", 401);
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
      const result = metaPool.write().run("DELETE FROM _sessions WHERE expires_at IS NOT NULL AND expires_at < datetime('now')");
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