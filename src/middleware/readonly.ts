import { DatabaseManager } from "../db/manager";

export function checkReadOnly(manager: DatabaseManager, databaseName: string): Response | null {
  try {
    const row = manager.getMetaPool().read()
      .query("SELECT config FROM _databases WHERE name = ?")
      .get(databaseName) as { config: string } | null;
    if (!row) return null;
    const config = JSON.parse(row.config);
    if (config.readonly) {
      return new Response(
        JSON.stringify({ error: { code: "READ_ONLY", message: "Database is in read-only mode." } }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch {}
  return null;
}
