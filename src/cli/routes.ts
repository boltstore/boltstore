import { loadConfig } from "../config";
import { DatabaseManager } from "../db/manager";
import { createRouter } from "../server";
import { out } from "../cli-style";

const ROUTE_DESCRIPTIONS: Record<string, { description: string; access: string }> = {
  "GET /api/health": { description: "Health check", access: "Public" },
  "POST /api/:database/auth/register": { description: "Register a new user", access: "Public" },
  "POST /api/:database/auth/login": { description: "Login and receive JWT tokens", access: "Public" },
  "POST /api/:database/auth/refresh": { description: "Refresh an expired access token", access: "Public" },
  "POST /api/:database/auth/logout": { description: "Logout and revoke tokens", access: "JWT token" },
  "GET /api/:database/auth/me": { description: "Get current user profile", access: "JWT token" },
  "PATCH /api/:database/auth/me": { description: "Update email or password", access: "JWT token" },
  "GET /api/:database/auth/oauth/:provider/url": { description: "Get OAuth provider authorization URL", access: "Public" },
  "POST /api/:database/auth/oauth/:provider": { description: "Exchange OAuth code for tokens", access: "Public" },
  "GET /api/:database/collections": { description: "List all collections", access: "JWT token or API key" },
  "GET /api/:database/collections/:collection": { description: "Get collection schema", access: "JWT token or API key" },
  "POST /api/:database/collections/:collection/records": { description: "Create a record", access: "JWT token or API key" },
  "GET /api/:database/collections/:collection/records": { description: "List records with filtering and pagination", access: "JWT token or API key" },
  "GET /api/:database/collections/:collection/records/count": { description: "Count records matching a filter", access: "JWT token or API key" },
  "GET /api/:database/collections/:collection/records/distinct": { description: "Get distinct values for a field", access: "JWT token or API key" },
  "GET /api/:database/collections/:collection/records/:id": { description: "Get a single record by ID", access: "JWT token or API key" },
  "PATCH /api/:database/collections/:collection/records/:id": { description: "Update a record by ID", access: "JWT token or API key" },
  "DELETE /api/:database/collections/:collection/records/:id": { description: "Delete a record by ID", access: "JWT token or API key" },
  "POST /api/:database/collections/:collection/records/batch": { description: "Batch create, update, or delete records", access: "JWT token or API key" },
  "POST /api/:database/query": { description: "Run a structured query with filtering and aggregation", access: "JWT token or API key" },
  "GET /api/:database/events/changes": { description: "List recent change log entries", access: "JWT token or API key" },
  "GET /api/:database/events/stream": { description: "SSE stream of realtime changes", access: "JWT token or API key" },
  "POST /api/admin/:database/collections": { description: "Create a new collection", access: "Admin JWT or admin API key" },
  "PATCH /api/admin/:database/collections/:collection": { description: "Update collection schema or RLS rules", access: "Admin JWT or admin API key" },
  "DELETE /api/admin/:database/collections/:collection": { description: "Delete a collection and all its records", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/collections": { description: "List all collections (admin view)", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/collections/:collection": { description: "Get collection details (admin view)", access: "Admin JWT or admin API key" },
  "GET /api/admin/databases": { description: "List all application databases", access: "Admin JWT or admin API key" },
  "POST /api/admin/databases": { description: "Create a new application database", access: "Admin JWT or admin API key" },
  "DELETE /api/admin/databases/:database": { description: "Delete an application database", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/query": { description: "Run a read-only SQL query", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/query/write": { description: "Run a write SQL query", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/query/explain": { description: "Explain a SQL query plan", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/collections/:collection/indexes": { description: "Create a database index", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/collections/:collection/indexes": { description: "List all indexes for a collection", access: "Admin JWT or admin API key" },
  "DELETE /api/admin/:database/collections/:collection/indexes/:name": { description: "Drop an index by name", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/transactions": { description: "Execute multiple SQL operations atomically", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/migrations": { description: "List applied migrations", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/migrations/up": { description: "Run pending migrations", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/migrations/down": { description: "Rollback the last migration", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/views": { description: "Create a SQL view", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/views": { description: "List all views", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/views/:name": { description: "Get view details or query a view", access: "Admin JWT or admin API key" },
  "DELETE /api/admin/:database/views/:name": { description: "Drop a view", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/backup": { description: "Create a database backup snapshot", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/backups": { description: "List all backups", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/restore/:backupId": { description: "Restore from a backup", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/collections/:collection/import": { description: "Import data from CSV or JSON", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/collections/:collection/export/stream": { description: "Stream export of collection data", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/collections/:collection/export": { description: "Export collection data to CSV or JSON", access: "Admin JWT or admin API key" },
  "POST /api/admin/:database/api-keys": { description: "Create a new API key", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/api-keys": { description: "List all API keys", access: "Admin JWT or admin API key" },
  "GET /api/admin/:database/api-keys/:id": { description: "Get a single API key", access: "Admin JWT or admin API key" },
  "DELETE /api/admin/:database/api-keys/:id": { description: "Revoke an API key", access: "Admin JWT or admin API key" },
  "GET /api/admin/health/detail": { description: "Detailed health check with database list", access: "Admin JWT or admin API key" },
};

function printTable(routes: { method: string; pattern: string }[], title: string): void {
  if (routes.length === 0) return;

  const rows = routes.map((r) => {
    const key = `${r.method} ${r.pattern}`;
    const info = ROUTE_DESCRIPTIONS[key] || { description: "", access: "" };
    return { method: r.method, pattern: r.pattern, description: info.description, access: info.access };
  });

  const methodWidth = Math.max(6, ...rows.map((r) => r.method.length));
  const routeWidth = Math.max(5, ...rows.map((r) => r.pattern.length));
  const descWidth = Math.max(11, ...rows.map((r) => r.description.length));
  const accessWidth = Math.max(6, ...rows.map((r) => r.access.length));

  const sep = `  +${"-".repeat(methodWidth + 2)}+${"-".repeat(routeWidth + 2)}+${"-".repeat(descWidth + 2)}+${"-".repeat(accessWidth + 2)}+`;

  out(`  ${title}:`);
  out(sep);
  out(`  | ${"Method".padEnd(methodWidth)} | ${"Route".padEnd(routeWidth)} | ${"Description".padEnd(descWidth)} | ${"Access".padEnd(accessWidth)} |`);
  out(`  |${"-".repeat(methodWidth + 2)}|${"-".repeat(routeWidth + 2)}|${"-".repeat(descWidth + 2)}|${"-".repeat(accessWidth + 2)}|`);

  for (const r of rows) {
    out(`  | ${r.method.padEnd(methodWidth)} | ${r.pattern.padEnd(routeWidth)} | ${r.description.padEnd(descWidth)} | ${r.access.padEnd(accessWidth)} |`);
  }

  out(sep);
  out("");
}

export async function routesCommand(): Promise<void> {
  const config = await loadConfig();
  const manager = new DatabaseManager({ dataDir: config.databasePath });
  const router = createRouter({ manager, auth: { secret: config.jwtSecret } });
  const routes = router.listRoutes();

  out("");

  const adminRoutes = routes.filter((r) => r.pattern.startsWith("/api/admin/"));
  const authRoutes = routes.filter((r) => r.pattern.startsWith("/api/") && !r.pattern.startsWith("/api/admin/"));

  printTable(authRoutes, "Authenticated");
  printTable(adminRoutes, "Admin");

  out("  WebSocket:");
  out(`  +--------+-------+----------------------------------------+------------------------------------------+`);
  out(`  | Method | Route | Description                            | Access                                   |`);
  out(`  |--------|-------|----------------------------------------|------------------------------------------|`);
  out(`  | GET    | /ws   | Realtime subscriptions via WebSocket   | JWT token (?token=) or API key (header)  |`);
  out(`  +--------+-------+----------------------------------------+------------------------------------------+`);
  out("");

  manager.close();
}
