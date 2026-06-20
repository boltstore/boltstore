import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { jsonResponse, errorResponse } from "../server";
import { authenticateRequest, type AuthConfig } from "../middleware/auth";
import { apiKeyAllows } from "../admin/api-keys";
import { createRecord, getRecord, updateRecord, deleteRecord } from "../records";
import { listChangesSince, getSyncState, upsertSyncState } from "../ws/changes";
import { notifyRecordChange } from "../ws/cdc";

const PER_RECORD_MAX_SIZE = parseInt(Bun.env.SYNC_RECORD_MAX_SIZE || "524288", 10); // 512 KB per record

function principalId(auth: Awaited<ReturnType<typeof authenticateRequest>>): string | undefined {
  return auth instanceof Response ? undefined : auth.principalId;
}

function isSystemCollection(name: string): boolean {
  return name.startsWith("_");
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
      operations?: { event: "create" | "update" | "delete"; collection: string; id?: string; data?: Record<string, unknown> }[];
      clientId?: string;
    };

    if (!Array.isArray(operations) || operations.length === 0) {
      return errorResponse("VALIDATION", "Request must contain a non-empty 'operations' array.", 400);
    }

    if (operations.length > 1000) {
      return errorResponse("VALIDATION", "Sync push limited to 1000 operations per request.", 400);
    }

    for (const op of operations) {
      if (op.data) {
        const size = new TextEncoder().encode(JSON.stringify(op.data)).byteLength;
        if (size > PER_RECORD_MAX_SIZE) {
          return errorResponse("VALIDATION", `Record data exceeds ${PER_RECORD_MAX_SIZE} bytes (${size} bytes).`, 400);
        }
      }
    }

    const pool = manager.get(params.database);

    type PushResult = { event: string; collection: string; id: string | null; status: string; error?: string };
    const results: PushResult[] = [];

    pool.writeTransaction(() => {
      for (const op of operations) {
        if (!op.collection || isSystemCollection(op.collection)) {
          results.push({ event: op.event, collection: op.collection, id: op.id ?? null, status: "error", error: "Cannot operate on system collections." });
          continue;
        }

        if (auth.isApiKey) {
          const apiOp = op.event === "delete" ? "delete" : (op.event === "create" ? "create" : "update");
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
              // Last-write-wins: always accept the update, even if baseVersion doesn't match.
              // The updated_at timestamp is advanced by updateRecord, so the latest write wins.
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
    return jsonResponse({ data: { ok: !hasErrors, results } }, hasErrors ? 207 : 200);
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
