import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { createCollection, listCollections, getCollection, updateCollection, deleteCollection } from "../collections";
import { type ColumnDefinition } from "@boltstore/utils";
import { jsonResponse, errorResponse } from "../server";

export function registerCollectionRoutes(router: Router, manager: DatabaseManager): void {
  router.get("/api/:database/collections", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: listCollections(pool) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list collections";
      return errorResponse("COLLECTIONS_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.get("/api/:database/collections/:collection", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      return jsonResponse({ data: getCollection(pool, params.collection) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get collection";
      return errorResponse("COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.post("/api/admin/:database/collections", async (req, params) => {
    try {
      const { name, columns } = await req.json();
      if (!name || typeof name !== "string") return errorResponse("VALIDATION", "Field 'name' is required.", 400);
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: createCollection(pool, name, columns as ColumnDefinition[]) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create collection";
      return errorResponse("CREATE_COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.patch("/api/admin/:database/collections/:collection", async (req, params) => {
    try {
      const { columns } = await req.json();
      if (!Array.isArray(columns)) return errorResponse("VALIDATION", "Field 'columns' is required.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: updateCollection(pool, params.collection, columns as ColumnDefinition[]) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update collection";
      return errorResponse("UPDATE_COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });

  router.delete("/api/admin/:database/collections/:collection", (_req, params) => {
    try {
      const pool = manager.get(params.database);
      deleteCollection(pool, params.collection);
      return jsonResponse({ data: { deleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete collection";
      return errorResponse("DELETE_COLLECTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}