/**
 * HTTP server for Boltstore — built on Bun.serve with routing, CORS, and logging.
 *
 * @module boltstore/server
 */

import { Router, type RouteHandler } from "./router";
import { logger, generateRequestId, type LogEntry } from "./logger";
import { applyCors, handlePreflight, type CorsConfig, defaultConfig as defaultCorsConfig } from "./middleware/cors";
import { DatabasePool } from "./db/pool";
import {
  createCollection,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
} from "./collections";
import { type ColumnDefinition } from "@boltstore/utils";
import pkg from "../package.json";

export interface ServerConfig {
  port: number;
  cors?: CorsConfig;
  dbPath?: string;
  pool?: DatabasePool;
}

export interface ApiResponse {
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Standard JSON response helper.
 */
export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  const body = JSON.stringify(data);
  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  return new Response(body, { status, headers: responseHeaders });
}

/**
 * Error response helper.
 */
export function errorResponse(code: string, message: string, status = 400, details?: unknown): Response {
  const body: ApiResponse = {
    error: { code, message, details },
  };
  return jsonResponse(body, status);
}

/**
 * Create and start the Boltstore HTTP server.
 */
export function createServer(config: ServerConfig): ReturnType<typeof Bun.serve> {
  const router = new Router();
  const corsConfig = config.cors || defaultCorsConfig;
  const pool = config.pool;

  // --- Routes ---

  // Health check
  router.get("/api/health", () => {
    const dbStats = pool ? pool.stats() : null;
    const body: ApiResponse = {
      data: {
        status: "ok",
        version: pkg.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: dbStats
          ? {
              path: dbStats.path,
              read_connections: dbStats.readConnections,
              write_connection: dbStats.writeConnection,
            }
          : null,
      },
    };
    return jsonResponse(body);
  });

  // --- Collection routes ---

  if (pool) {
    // GET /api/collections — list all collections
    router.get("/api/collections", () => {
      try {
        const collections = listCollections(pool);
        const body: ApiResponse = { data: collections };
        return jsonResponse(body);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list collections";
        const status = (err as { status?: number }).status || 500;
        return errorResponse("COLLECTIONS_ERROR", message, status);
      }
    });

    // GET /api/collections/:collection — get collection details
    router.get("/api/collections/:collection", (_req, params) => {
      try {
        const info = getCollection(pool, params.collection);
        const body: ApiResponse = { data: info };
        return jsonResponse(body);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to get collection";
        const status = (err as { status?: number }).status || 500;
        return errorResponse("COLLECTION_ERROR", message, status);
      }
    });

    // POST /api/admin/collections — create collection (admin)
    router.post("/api/admin/collections", async (req) => {
      try {
        const body = await req.json();
        const { name, columns } = body;

        if (!name || typeof name !== "string") {
          return errorResponse("VALIDATION", "Field 'name' is required and must be a string.", 400);
        }
        if (!Array.isArray(columns)) {
          return errorResponse("VALIDATION", "Field 'columns' is required and must be an array.", 400);
        }

        const result = createCollection(pool!, name, columns as ColumnDefinition[]);
        const resp: ApiResponse = { data: result };
        return jsonResponse(resp, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create collection";
        const status = (err as { status?: number }).status || 500;
        return errorResponse("CREATE_COLLECTION_ERROR", message, status);
      }
    });

    // PATCH /api/admin/collections/:collection — update collection schema (admin)
    router.patch("/api/admin/collections/:collection", async (req, params) => {
      try {
        const body = await req.json();
        const { columns } = body;

        if (!Array.isArray(columns)) {
          return errorResponse("VALIDATION", "Field 'columns' is required and must be an array.", 400);
        }

        const result = updateCollection(pool!, params.collection, columns as ColumnDefinition[]);
        const resp: ApiResponse = { data: result };
        return jsonResponse(resp);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update collection";
        const status = (err as { status?: number }).status || 500;
        return errorResponse("UPDATE_COLLECTION_ERROR", message, status);
      }
    });

    // DELETE /api/admin/collections/:collection — delete collection (admin)
    router.delete("/api/admin/collections/:collection", (_req, params) => {
      try {
        deleteCollection(pool!, params.collection);
        const body: ApiResponse = { data: { deleted: true } };
        return jsonResponse(body);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete collection";
        const status = (err as { status?: number }).status || 500;
        return errorResponse("DELETE_COLLECTION_ERROR", message, status);
      }
    });
  }

  // --- Server creation ---

  const server = Bun.serve({
    port: config.port,
    async fetch(request: Request): Promise<Response> {
      const requestId = generateRequestId();
      const startTime = performance.now();
      const url = new URL(request.url);
      const method = request.method;
      const pathname = url.pathname;

      const logMeta: Partial<LogEntry> = {
        request_id: requestId,
        method,
        path: pathname,
      };

      try {
        if (method === "OPTIONS") {
          const origin = request.headers.get("Origin");
          logger.debug("CORS preflight", logMeta);
          return handlePreflight(origin, corsConfig);
        }

        let response: Response;
        const match = router.match(method, pathname);

        if (!match) {
          response = errorResponse("NOT_FOUND", `Route not found: ${method} ${pathname}`, 404);
        } else {
          try {
            response = await match.handler(request, match.params);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Internal server error";
            logger.error("Handler error", { ...logMeta, error: message });
            response = errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
          }
        }

        const origin = request.headers.get("Origin");
        if (origin) {
          response = applyCors(response, origin, corsConfig);
        }

        const durationMs = Math.round(performance.now() - startTime);
        logger.info(`${method} ${pathname} ${response.status}`, {
          ...logMeta,
          status: response.status,
          duration_ms: durationMs,
        });

        return response;
      } catch (err) {
        const durationMs = Math.round(performance.now() - startTime);
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Request error", { ...logMeta, error: message, duration_ms: durationMs });

        const origin = request.headers.get("Origin");
        let response = errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
        if (origin) {
          response = applyCors(response, origin, corsConfig);
        }
        return response;
      }
    },
  });

  logger.info(`Server started`, { request_id: "system", method: "N/A", path: "N/A", status: 200, duration_ms: 0 });
  logger.info(`Listening on http://localhost:${config.port}`, { request_id: "system", method: "N/A", path: "N/A", status: 200, duration_ms: 0 });
  logger.info(`Health check: http://localhost:${config.port}/api/health`, { request_id: "system", method: "N/A", path: "N/A", status: 200, duration_ms: 0 });

  return server;
}

export { Router };