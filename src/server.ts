/**
 * HTTP server for Boltstore — built on Bun.serve with routing, CORS, rate limiting, and logging.
 *
 * Route handlers are organized in `src/routes/` for maintainability.
 *
 * @module boltstore/server
 */

import { Router, type RouteHandler } from "./router";
import { logger, generateRequestId, type LogEntry } from "./logger";
import { applyCors, handlePreflight, type CorsConfig, defaultConfig as defaultCorsConfig } from "./middleware/cors";
import { checkRateLimit, type RateLimitConfig } from "./middleware/rate-limit";
import { DatabaseManager } from "./db/manager";
import { registerHealthRoutes } from "./routes/health";
import { registerDatabaseRoutes } from "./routes/databases";
import { registerCollectionRoutes } from "./routes/collections";
import { registerRecordRoutes } from "./routes/records";
import { registerQueryRoutes } from "./routes/query";
import { registerAdminQueryRoutes } from "./routes/admin-query";
import { registerIndexRoutes } from "./routes/indexes";
import { registerTransactionRoutes } from "./routes/transactions";
import { registerMigrationRoutes } from "./routes/migrations";
import { registerViewRoutes } from "./routes/views";
import { registerBackupRoutes } from "./routes/backup";
import { registerImportExportRoutes } from "./routes/import-export";
import { registerAuthRoutes } from "./routes/auth";
import { registerOAuthRoutes } from "./routes/oauth";
import { registerApiKeyRoutes } from "./routes/api-keys";
import { type AuthConfig } from "./auth";

export interface ServerConfig {
  port: number;
  cors?: CorsConfig;
  manager?: DatabaseManager;
  auth?: AuthConfig;
  /** Rate limit configuration. If set, rate limiting is enforced on all routes. */
  rateLimit?: RateLimitConfig;
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
 * Determine the rate limit tier for a request based on its path.
 * Returns "admin" | "auth" | "public".
 */
function getRateLimitTier(pathname: string): "admin" | "auth" | "public" {
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/")) return "auth";
  return "public";
}

/**
 * Create and start the Boltstore HTTP server.
 */
export function createServer(config: ServerConfig): ReturnType<typeof Bun.serve> {
  const router = new Router();
  const corsConfig = config.cors || defaultCorsConfig;
  const manager = config.manager;
  const rateLimit = config.rateLimit;

  // Register all route groups
  registerHealthRoutes(router, manager);
  if (manager) {
    registerDatabaseRoutes(router, manager);
    registerCollectionRoutes(router, manager);
    registerRecordRoutes(router, manager);
    registerQueryRoutes(router, manager);
    registerAdminQueryRoutes(router, manager);
    registerIndexRoutes(router, manager);
    registerTransactionRoutes(router, manager);
    registerMigrationRoutes(router, manager);
    registerViewRoutes(router, manager);
    registerBackupRoutes(router, manager);
    registerImportExportRoutes(router, manager);
    registerAuthRoutes(router, manager, config.auth || {});
    registerOAuthRoutes(router, manager, config.auth || {});
    registerApiKeyRoutes(router, manager);
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
        // --- Rate limiting ---
        if (rateLimit) {
          const tier = getRateLimitTier(pathname);
          const clientIp = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
            || request.headers.get("X-Real-IP")
            || "127.0.0.1";

          const limitResult = checkRateLimit(clientIp, pathname, tier, rateLimit);
          if (!limitResult.allowed) {
            logger.warn("Rate limit exceeded", {
              ...logMeta,
              client_ip: clientIp,
              tier,
              retry_after: limitResult.retryAfter,
            });
            const response = errorResponse(
              "RATE_LIMITED",
              `Too many requests. Try again in ${Math.ceil(limitResult.retryAfter)} seconds.`,
              429
            );
            response.headers.set("Retry-After", String(Math.ceil(limitResult.retryAfter)));
            response.headers.set("X-RateLimit-Limit", String(limitResult.limit));
            response.headers.set("X-RateLimit-Remaining", String(limitResult.remaining));
            response.headers.set("X-RateLimit-Reset", String(limitResult.reset));
            return response;
          }
        }

        // --- CORS preflight ---
        if (method === "OPTIONS") {
          const origin = request.headers.get("Origin");
          logger.debug("CORS preflight", logMeta);
          return handlePreflight(origin, corsConfig);
        }

        // --- Route matching ---
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

        // --- CORS headers ---
        const origin = request.headers.get("Origin");
        if (origin) {
          response = applyCors(response, origin, corsConfig);
        }

        // --- Logging ---
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