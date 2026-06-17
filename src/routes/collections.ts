import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createCollection, listCollections, getCollection, updateCollection, deleteCollection } from "../collections";
import { type ColumnDefinition } from "@boltstore/utils";
import { jsonResponse, errorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

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
      const { name, columns, relations, rls } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      const result = createCollection(pool, name, columns as ColumnDefinition[], { relations, rls });
      auditCollectionEvent("collection.create", req, auth, params.database, name, true, undefined, { columns });
      return jsonResponse({ data: result }, 201);
    } catch (err) {
      auditCollectionEvent("collection.create", req, auth, params.database, "", false, err instanceof Error ? err.message : "Failed to create collection");
      const message = err instanceof Error ? err.message : "Failed to create collection";
      return errorResponse("CREATE_COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.patch("/api/admin/:database/collections/:collection", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { columns, relations, rls } = await req.json();
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      const result = updateCollection(pool, params.collection, columns as ColumnDefinition[], { relations, rls });
      auditCollectionEvent("collection.update", req, auth, params.database, params.collection, true, undefined, { columns, relations, rls });
      return jsonResponse({ data: result });
    } catch (err) {
      auditCollectionEvent("collection.update", req, auth, params.database, params.collection, false, err instanceof Error ? err.message : "Failed to update collection");
      const message = err instanceof Error ? err.message : "Failed to update collection";
      return errorResponse("UPDATE_COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
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
      const message = err instanceof Error ? err.message : "Failed to delete collection";
      return errorResponse("DELETE_COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}