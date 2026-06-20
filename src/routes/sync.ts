import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { apiKeyAllows } from "../admin/api-keys";
import { createRecord, getRecord, updateRecord, deleteRecord } from "../records";
import { listChangesSince, getSyncState, upsertSyncState } from "../ws/changes";
import { notifyRecordChange } from "../ws/cdc";
import type { ConflictStrategy } from "@boltstore/utils";
import { toBindings } from "../db/cast";

function principalId(auth: Awaited<ReturnType<typeof authenticateRequest>>): string | undefined {
  return auth instanceof Response ? undefined : auth.principalId;
}

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
}

function getConflictStrategy(pool: import("../db/pool").DatabasePool, collection: string): ConflictStrategy {
  try {
    const row = pool.write().query("SELECT conflict_strategy FROM _collections WHERE name=?").get(collection) as { conflict_strategy?: string } | null;
    if (row?.conflict_strategy && ["last-write-wins", "server-wins", "client-merge"].includes(row.conflict_strategy)) {
      return row.conflict_strategy as ConflictStrategy;
    }
  } catch {}
  return "last-write-wins";
}

function getRecordUpdatedAt(pool: import("../db/pool").DatabasePool, collection: string, id: string): string | null {
  try {
    const row = pool.write().query(`SELECT updated_at FROM "${collection}" WHERE id=?`).get(id) as { updated_at?: string } | null;
    return row?.updated_at ?? null;
  } catch {
    return null;
  }
}

export function registerSyncRoutes(router: Router, manager: DatabaseManager, authConfig: AuthConfig): void {
  router.post("/api/:database/sync/pull", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
    }

    const { cursor, collection, limit } = body as { cursor?: number | null; collection?: string; limit?: number };

    if (collection && isSystemCollection(collection) && !auth.isAdmin) {
      return errorResponse("FORBIDDEN", "Cannot sync system collections.", 403);
    }

    if (auth.isApiKey && collection) {
      if (!apiKeyAllows(auth.apiKey!, params.database, "read", collection)) {
        return errorResponse("FORBIDDEN", "API key lacks permission for this collection.", 403);
      }
    }

    const pool = manager.get(params.database);
    const result = listChangesSince(pool, {
      cursor: cursor ?? undefined,
      collection,
      limit: Math.min(limit ?? 100, 1000),
    });

    // Filter changes through RLS — non-admin users should only see
    // changes for records they have read access to.
    if (!auth.isAdmin) {
      result.changes = result.changes.filter((change) => {
        if (!change.recordId) return true;
        try {
          const record = getRecord(pool, change.collection, change.recordId, auth);
          return true;
        } catch {
          if (change.event === "delete") return true;
          return false;
        }
      });
    }

    return jsonResponse({ data: result });
  });

  router.post("/api/:database/sync/push", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
    }

    const { operations, clientId } = body as {
      operations?: { event: "create" | "update" | "delete"; collection: string; id?: string; data?: Record<string, unknown>; baseVersion?: string }[];
      clientId?: string;
    };
    const requestStrategy = (body as { strategy?: string }).strategy;

    if (!Array.isArray(operations) || operations.length === 0) {
      return errorResponse("VALIDATION", "Request must contain a non-empty 'operations' array.", 400);
    }

    if (operations.length > 1000) {
      return errorResponse("VALIDATION", "Sync push limited to 1000 operations per request.", 400);
    }

    const pool = manager.get(params.database);

    type PushResult = { event: string; collection: string; id: string | null; status: string; error?: string; conflict?: { serverVersion: Record<string, unknown>; clientVersion: Record<string, unknown>; strategy: string } };
    const results: PushResult[] = [];

    pool.writeTransaction(() => {
      for (const op of operations) {
        if (!op.collection || isSystemCollection(op.collection)) {
          results.push({ event: op.event, collection: op.collection, id: op.id ?? null, status: "error", error: "Cannot operate on system collections." });
          continue;
        }

        if (auth.isApiKey) {
          const apiOp = op.event === "delete" ? "delete" : "write";
          if (!apiKeyAllows(auth.apiKey!, params.database, apiOp, op.collection)) {
            results.push({ event: op.event, collection: op.collection, id: op.id ?? null, status: "error", error: "API key lacks permission." });
            continue;
          }
        }

        try {
          switch (op.event) {
            case "create": {
              const record = createRecord(pool, op.collection, op.data ?? {}, auth);
              const recordId = record.id as string;
              notifyRecordChange("create", params.database, op.collection, record, undefined, pool, principalId(auth));
              results.push({ event: "create", collection: op.collection, id: recordId, status: "created" });
              break;
            }
            case "update": {
              if (!op.id) {
                results.push({ event: "update", collection: op.collection, id: null, status: "error", error: "Missing 'id' for update." });
                continue;
              }
              const strategy = getConflictStrategy(pool, op.collection);
              if (op.baseVersion) {
                const currentUpdatedAt = getRecordUpdatedAt(pool, op.collection, op.id);
                if (currentUpdatedAt !== null && currentUpdatedAt !== op.baseVersion) {
                  const serverRecord = getRecord(pool, op.collection, op.id, auth);
                  if (strategy === "server-wins") {
                    results.push({ event: "update", collection: op.collection, id: op.id, status: "conflict", conflict: { serverVersion: serverRecord, clientVersion: op.data ?? {}, strategy: "server-wins" } });
                    continue;
                  }
                  if (strategy === "client-merge") {
                    results.push({ event: "update", collection: op.collection, id: op.id, status: "conflict", conflict: { serverVersion: serverRecord, clientVersion: op.data ?? {}, strategy: "client-merge" } });
                    continue;
                  }
                }
              }
              const previous = getRecord(pool, op.collection, op.id, auth);
              const record = updateRecord(pool, op.collection, op.id, op.data ?? {}, auth);
              notifyRecordChange("update", params.database, op.collection, record, previous, pool, principalId(auth));
              results.push({ event: "update", collection: op.collection, id: op.id, status: "updated" });
              break;
            }
            case "delete": {
              if (!op.id) {
                results.push({ event: "delete", collection: op.collection, id: null, status: "error", error: "Missing 'id' for delete." });
                continue;
              }
              const record = getRecord(pool, op.collection, op.id, auth);
              deleteRecord(pool, op.collection, op.id, auth);
              notifyRecordChange("delete", params.database, op.collection, record, undefined, pool, principalId(auth));
              results.push({ event: "delete", collection: op.collection, id: op.id, status: "deleted" });
              break;
            }
            default:
              results.push({ event: op.event, collection: op.collection, id: op.id ?? null, status: "error", error: `Unknown event type "${(op as { event: string }).event}".` });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ event: op.event, collection: op.collection, id: op.id ?? null, status: "error", error: message });
        }
      }
    });

    const hasErrors = results.some((r) => r.status === "error");
    const hasConflicts = results.some((r) => r.status === "conflict");
    return jsonResponse({ data: { ok: !hasErrors, results } }, hasConflicts ? 409 : (hasErrors ? 207 : 200));
  });

  router.post("/api/:database/sync/state", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("VALIDATION", "Request body must be a JSON object.", 400);
    }

    const { clientId, cursor } = body as { clientId?: string; cursor?: number | null };

    if (!clientId || typeof clientId !== "string") {
      return errorResponse("VALIDATION", "clientId is required.", 400);
    }

    const pool = manager.get(params.database);

    if (cursor !== undefined) {
      upsertSyncState(pool, clientId, cursor ?? null);
    }

    const state = getSyncState(pool, clientId);
    return jsonResponse({ data: state ?? { clientId, cursor: null, lastSyncAt: null } });
  });
}
