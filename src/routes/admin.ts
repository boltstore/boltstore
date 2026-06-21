import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { logActivity } from "./activity";

export function registerAdminRoutes(router: Router, manager: DatabaseManager, adminKey?: string): void {
  const metaPool = manager.getMetaPool();

  // Check if any admin exists — used by dashboard to decide setup vs login
  router.get("/api/admin/status", () => {
    const count = (metaPool.read().query("SELECT COUNT(*) as c FROM _admins").get() as any)?.c ?? 0;
    return jsonResponse({ data: { hasAdmins: count > 0 } });
  });

  // Create first admin (no auth required if no admins exist, or bootstrap key provided)
  router.post("/api/admin/setup", async (req) => {
    const body = await req.json() as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return errorResponse("VALIDATION", "Username and password are required.", 400);
    }
    if (body.username.length < 3) return errorResponse("VALIDATION", "Username must be at least 3 characters.", 400);
    if (body.password.length < 8) return errorResponse("VALIDATION", "Password must be at least 8 characters.", 400);

    const existing = metaPool.read().query("SELECT COUNT(*) as c FROM _admins").get() as any;
    if (existing.c > 0) {
      // If admins exist, require the bootstrap key
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ") || auth.slice(7).trim() !== adminKey) {
        return errorResponse("UNAUTHORIZED", "Bootstrap key required to create additional admins.", 401);
      }
    }

    // Check duplicate username
    const dup = metaPool.read().query("SELECT 1 FROM _admins WHERE username = ?").get(body.username);
    if (dup) return errorResponse("CONFLICT", "Username already exists.", 409);

    const id = generateId("adm_");
    const passwordHash = await Bun.password.hash(body.password, { algorithm: "bcrypt", cost: 10 });
    metaPool.write().run("INSERT INTO _admins (id, username, password_hash) VALUES (?, ?, ?)", [id, body.username, passwordHash]);

    logActivity(manager, { action: "admin.create" });
    return jsonResponse({ data: { id, username: body.username } }, 201);
  });

  // Login
  router.post("/api/admin/login", async (req) => {
    const body = await req.json() as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return errorResponse("VALIDATION", "Username and password are required.", 400);
    }

    const row = metaPool.read().query("SELECT id, username, password_hash FROM _admins WHERE username = ?").get(body.username) as any;
    if (!row) return errorResponse("UNAUTHORIZED", "Invalid username or password.", 401);

    const valid = await Bun.password.verify(body.password, row.password_hash);
    if (!valid) return errorResponse("UNAUTHORIZED", "Invalid username or password.", 401);

    const token = generateId("sess_") + generateId("");
    const sessId = generateId("ssn_");
    metaPool.write().run("INSERT INTO _sessions (id, admin_id, token) VALUES (?, ?, ?)", [sessId, row.id, token]);

    logActivity(manager, { action: "admin.login", details: { admin: row.username } });
    return jsonResponse({ data: { token, admin: { id: row.id, username: row.username } } });
  });

  // Get current admin from session token
  router.get("/api/admin/me", async (req) => {
    const token = extractToken(req);
    if (!token) return errorResponse("UNAUTHORIZED", "Not authenticated.", 401);

    const row = metaPool.read().query(`
      SELECT a.id, a.username FROM _admins a
      JOIN _sessions s ON s.admin_id = a.id
      WHERE s.token = ?
    `).get(token) as any;

    if (!row) return errorResponse("UNAUTHORIZED", "Invalid session.", 401);
    return jsonResponse({ data: { id: row.id, username: row.username } });
  });

  // Logout (delete session)
  router.post("/api/admin/logout", async (req) => {
    const token = extractToken(req);
    if (token) metaPool.write().run("DELETE FROM _sessions WHERE token = ?", [token]);
    return jsonResponse({ data: { loggedOut: true } });
  });
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

function generateId(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 24; i++) id += chars[bytes[i] % chars.length];
  return prefix + id;
}
