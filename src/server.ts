/**
 * HTTP server for Boltstore — built on Bun.serve with routing, CORS, rate limiting, and logging.
 *
 * Route handlers are organized in `src/routes/` for maintainability.
 *
 * @module boltstore/server
 */

import { Router, type RouteHandler } from "./router";
import { logger, generateRequestId, type LogEntry, flushLogger, stopLogger } from "./logger";
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
import { startTokenCleanup, stopTokenCleanup, type AuthConfig } from "./auth";
import { resolveClientIp } from "./middleware/proxy";
import { logAuditEvent, type AuditEvent } from "./audit";
export { logAuditEvent, type AuditEvent };

export interface ServerConfig {
  port: number;
  cors?: CorsConfig;
  manager?: DatabaseManager;
  auth?: AuthConfig;
  /** Rate limit configuration. If set, rate limiting is enforced on all routes. */
  rateLimit?: RateLimitConfig;
  /** Optional list of trusted proxy IPs/CIDRs. When empty, X-Forwarded-For is ignored. */
  trustedProxies?: string[];
  /** Maximum request body size in bytes. Default: 1 MB. */
  maxBodySize?: number;
  /** Maximum number of operations in a single transaction/batch. Default: 1000. */
  maxBatchSize?: number;
  /** Maximum number of rows accepted by the import endpoint. Default: 100000. */
  maxImportRows?: number;
  /** Request handler timeout in milliseconds. 0 disables. Default: 30000. */
  requestTimeoutMs?: number;
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

export interface RequestContext {
  requestId: string;
  request: Request;
  ip?: string;
  userAgent?: string;
}

export const requestContext = new WeakMap<Request, RequestContext>();

/** Attach request metadata for downstream audit logging. */
export function attachRequestContext(request: Request, ctx: RequestContext): void {
  requestContext.set(request, ctx);
}

/** Build an audit event from the current request context. */
export function auditFromRequest(request: Request, event: Omit<AuditEvent, "ip" | "userAgent">): AuditEvent {
  const ctx = requestContext.get(request);
  return {
    ...event,
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
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

export const MAX_RESPONSE_SIZE = parseInt(Bun.env.MAX_RESPONSE_SIZE || "10485760", 10); // 10 MB default

/**
 * Error response helper.
 */
export function errorResponse(code: string, message: string, status = 400, details?: unknown): Response {
  const body: ApiResponse = {
    error: { code, message, details },
  };
  return jsonResponse(body, status);
}

/** Classify an error as operational (has a safe client-facing status/message). */
function isOperationalError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as { status?: number }).status === "number";
}

/**
 * Convert any caught error into a safe, generic error response.
 * Operational errors preserve their HTTP status and a sanitized message.
 * Unexpected errors return 500 with a generic message and log the full stack.
 */
export function safeErrorResponse(err: unknown, logMeta?: Partial<LogEntry>): Response {
  if (isOperationalError(err)) {
    const status = err.status;
    const message = err.message || "Request failed.";
    return errorResponse("REQUEST_ERROR", message, status);
  }
  logger.error("Unexpected handler error", { ...logMeta, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
  return errorResponse("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}

/**
 * Wrap a JSON response and reject if it exceeds the maximum response body size.
 */
export function jsonResponseBounded(data: unknown, status = 200, headers?: Record<string, string>): Response {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_SIZE) {
    return errorResponse(
      "RESPONSE_TOO_LARGE",
      `Response body exceeds ${MAX_RESPONSE_SIZE} bytes. Use pagination or export with limit/offset.`,
      413
    );
  }
  return new Response(body, { status, headers: { "Content-Type": "application/json", ...headers } });
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
  const trustedProxies = config.trustedProxies || [];
  const maxBodySize = config.maxBodySize ?? 1024 * 1024;
  const maxImportRows = config.maxImportRows ?? 100000;
  const requestTimeoutMs = config.requestTimeoutMs ?? 30000;

  if (corsConfig.origins.includes("*")) {
    logger.warn("CORS is configured to allow all origins (*). Ensure strong authentication is in place.", {
      request_id: "system", method: "N/A", path: "N/A", status: 200, duration_ms: 0,
    });
  }

  // Start token cleanup on the meta pool if a manager is present
  if (manager) {
    startTokenCleanup(manager.getMetaPool());
  }

  // Register all route groups
  registerHealthRoutes(router, manager);
  if (manager) {
    const authCfg = config.auth || {};
    registerDatabaseRoutes(router, manager, authCfg);
    registerCollectionRoutes(router, manager, authCfg);
    registerRecordRoutes(router, manager, authCfg);
    registerQueryRoutes(router, manager, authCfg);
    registerAdminQueryRoutes(router, manager, authCfg);
    registerIndexRoutes(router, manager, authCfg);
    registerTransactionRoutes(router, manager, authCfg);
    registerMigrationRoutes(router, manager, authCfg);
    registerViewRoutes(router, manager, authCfg);
    registerBackupRoutes(router, manager, authCfg);
    registerImportExportRoutes(router, manager, authCfg, { maxImportRows });
    registerAuthRoutes(router, manager, authCfg);
    registerOAuthRoutes(router, manager, authCfg);
    registerApiKeyRoutes(router, manager, authCfg);
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

      const remoteAddress = (request as unknown as { remoteAddress?: string }).remoteAddress;
      const clientIp = resolveClientIp(request, trustedProxies, remoteAddress);
      const userAgent = request.headers.get("User-Agent") || undefined;

      attachRequestContext(request, {
        requestId,
        request,
        ip: clientIp,
        userAgent,
      });

      const logMeta: Partial<LogEntry> = {
        request_id: requestId,
        method,
        path: pathname,
        client_ip: clientIp,
        user_agent: userAgent,
      };

      try {
        // --- Request size limit ---
        const contentLength = request.headers.get("Content-Length");
        if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
          return errorResponse("PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodySize} bytes limit.`, 413);
        }

        // --- Rate limiting ---
        if (rateLimit) {
          const tier = getRateLimitTier(pathname);
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

        // --- Request timeout ---
        const timeoutPromise = requestTimeoutMs > 0
          ? new Promise<Response>((_, reject) =>
              setTimeout(() => reject(new Error("Request timeout")), requestTimeoutMs)
            )
          : null;

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
          const handlerPromise = match.handler(request, match.params);
          try {
            response = timeoutPromise
              ? await Promise.race([handlerPromise, timeoutPromise])
              : await handlerPromise;
          } catch (err) {
            const isTimeout = err instanceof Error && err.message === "Request timeout";
            if (isTimeout) {
              logger.warn("Request timeout", logMeta);
              response = errorResponse("REQUEST_TIMEOUT", "Request timed out.", 408);
            } else {
              const message = err instanceof Error ? err.message : "Internal server error";
              logger.error("Handler error", { ...logMeta, error: message, stack: err instanceof Error ? err.stack : undefined });
              response = errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
            }
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

        // Flush logs for the response so audit/error logs are written promptly.
        flushLogger();

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

/** Stop background tasks (rate-limit cleanup, token cleanup, logger). */
export function stopServerBackgroundTasks(): void {
  stopTokenCleanup();
  stopLogger();
}

export { Router };