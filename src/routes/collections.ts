import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createCollection, listCollections, getCollection, updateCollection, deleteCollection } from "../collections";
import { type ColumnDefinition } from "@boltstore/utils";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";
import type { RelationDefinition } from "../relations";

interface RequestRelation {
  field?: string;
  target?: string;
  cascadeDelete?: boolean;
  cascade?: boolean;
  targetField?: string;
  type?: string;
  through?: string;
  localKey?: string;
  foreignKey?: string;
}

/**
 * Convert the array-based relations format from REST API requests to the
 * Record<string, RelationDefinition> format expected by createCollection.
 */
function normalizeRelations(requestRelations: unknown): Record<string, RelationDefinition> | undefined {
  if (!Array.isArray(requestRelations) || requestRelations.length === 0) return undefined;
  const result: Record<string, RelationDefinition> = {};
  for (const rel of requestRelations as RequestRelation[]) {
    if (!rel.field || typeof rel.field !== "string") continue;
    if (!rel.target || typeof rel.target !== "string") continue;
    result[rel.field] = {
      field: rel.field,
      foreignCollection: rel.target,
      cascadeDelete: rel.cascadeDelete ?? rel.cascade ?? false,
      type: rel.type as RelationDefinition["type"],
      through: rel.through,
      localKey: rel.localKey,
      foreignKey: rel.foreignKey,
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function auditCollectionEvent(
  type: "collection.create" | "collection.update" | "collection.delete",
  request: Request,
  auth: Awaited<ReturnType<typeof authenticateRequest>>,
  database: string,
  collection: string,
  success: boolean,
  error?: string,
  details?: Record<string, unknown>
) {
  if (auth instanceof Response) return;
  logAuditEvent(auditFromRequest(request, {
    type,
    principalId: auth.principalId,
    principalType: auth.isApiKey ? "api_key" : "user",
    database,
    collection,
    action: type.split(".")[1],
    target: collection,
    success,
    error,
    details,
  }));
}

export function registerCollectionRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.get("/api/:database/collections", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: listCollections(pool) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list collections";
      return errorResponse("COLLECTIONS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;

    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: getCollection(pool, params.collection) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get collection";
      return errorResponse("COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/collections", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { name, columns, relations, rls, conflictStrategy } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      const result = createCollection(pool, name, columns as ColumnDefinition[], { relations: normalizeRelations(relations), rls, conflictStrategy });
      auditCollectionEvent("collection.create", req, auth, params.database, name, true, undefined, { columns, conflictStrategy });
      const responseData: Record<string, unknown> = { ...result };
      if (!rls) {
        responseData.warning = "No Row-Level Security (RLS) rules configured. All authenticated users can read and write every record in this collection. To add RLS, send a PATCH request with an 'rls' field: { \"rls\": { \"read\": \"owner_id = $userId\", \"write\": \"owner_id = $userId\" } }";
      }
      return jsonResponse({ data: responseData }, 201);
    } catch (err) {
      auditCollectionEvent("collection.create", req, auth, params.database, "", false, err instanceof Error ? err.message : "Failed to create collection");
      return safeErrorResponse(err);
    }
  });

  router.patch("/api/admin/:database/collections/:collection", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { columns, relations, rls, conflictStrategy } = await req.json();
      if (columns !== undefined && !Array.isArray(columns)) {
        return errorResponse("VALIDATION", "Field 'columns' must be an array.", 400);
      }
      if (!columns && columns === undefined && !rls && !conflictStrategy && !relations) {
        return errorResponse("VALIDATION", "At least one of 'columns', 'rls', 'conflictStrategy', or 'relations' is required.", 400);
      }
      const pool = manager.get(params.database);
      // Only pass columns array if actually changing columns — undefined means no column changes
      const result = updateCollection(pool, params.collection, columns as ColumnDefinition[] | undefined, { relations: normalizeRelations(relations), rls, conflictStrategy });
      auditCollectionEvent("collection.update", req, auth, params.database, params.collection, true, undefined, { columns, relations, rls, conflictStrategy });
      return jsonResponse({ data: result });
    } catch (err) {
      auditCollectionEvent("collection.update", req, auth, params.database, params.collection, false, err instanceof Error ? err.message : "Failed to update collection");
      return safeErrorResponse(err);
    }
  });

  router.delete("/api/admin/:database/collections/:collection", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const pool = manager.get(params.database);
      deleteCollection(pool, params.collection);
      auditCollectionEvent("collection.delete", req, auth, params.database, params.collection, true);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      auditCollectionEvent("collection.delete", req, auth, params.database, params.collection, false, err instanceof Error ? err.message : "Failed to delete collection");
      return safeErrorResponse(err);
    }
  });
}