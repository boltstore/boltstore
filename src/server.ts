import { Router } from "./router";
import { logger, generateRequestId, flushLogger, stopLogger } from "./logger";
import { applyCors, handlePreflight, type CorsConfig, defaultConfig as defaultCorsConfig } from "./middleware/cors";
import { DatabaseManager } from "./db/manager";
import { registerHealthRoutes } from "./routes/health";
import { registerDatabaseRoutes } from "./routes/databases";
import { registerApiKeyRoutes } from "./routes/keys";
import { registerTableRoutes } from "./routes/tables";
import { registerRecordRoutes } from "./routes/records";
import { registerQueryRoutes } from "./routes/query";
import { registerConfigRoutes } from "./routes/config";

export interface ServerConfig {
  port: number;
  cors?: CorsConfig;
  manager?: DatabaseManager;
  maxBodySize?: number;
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

export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_SIZE) {
    return errorResponse(
      "RESPONSE_TOO_LARGE",
      `Response body exceeds ${MAX_RESPONSE_SIZE} bytes. Use limit/offset pagination.`,
      413
    );
  }
  return new Response(body, { status, headers: { "Content-Type": "application/json", ...headers } });
}

export class RequestTimeoutError extends Error {
  status = 408;
  constructor() {
    super("Request timeout");
    this.name = "RequestTimeoutError";
  }
}

export const MAX_RESPONSE_SIZE = parseInt(Bun.env.MAX_RESPONSE_SIZE || "10485760", 10);

export function errorResponse(code: string, message: string, status = 400, details?: unknown): Response {
  return jsonResponse({ error: { code, message, details } }, status);
}

function isOperationalError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as { status?: number }).status === "number";
}

export function safeErrorResponse(err: unknown): Response {
  if (isOperationalError(err)) {
    return errorResponse("REQUEST_ERROR", err.message || "Request failed.", err.status);
  }
  if (err instanceof SyntaxError || (err instanceof Error && err.name === "SyntaxError")) {
    return errorResponse("INVALID_JSON", "Invalid JSON in request body.", 400);
  }
  logger.error("Unexpected handler error", { error: err instanceof Error ? err.message : String(err) });
  return errorResponse("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}

export function createRouter(config: { manager?: DatabaseManager }): Router {
  const router = new Router();
  const manager = config.manager;

  registerHealthRoutes(router, manager);
  if (manager) {
    registerDatabaseRoutes(router, manager);
    registerApiKeyRoutes(router, manager);
    registerTableRoutes(router, manager);
    registerRecordRoutes(router, manager);
    registerQueryRoutes(router, manager);
    registerConfigRoutes(router, manager);
  }
  return router;
}

export function createServer(config: ServerConfig): ReturnType<typeof Bun.serve> {
  const router = createRouter(config);
  const corsConfig = config.cors || defaultCorsConfig;
  const maxBodySize = config.maxBodySize ?? 1024 * 1024;
  const requestTimeoutMs = config.requestTimeoutMs ?? 30000;

  const server = Bun.serve({
    port: config.port,
    async fetch(request: Request): Promise<Response> {
      const requestId = generateRequestId();
      const startTime = performance.now();
      const url = new URL(request.url);
      const method = request.method;
      const pathname = url.pathname;

      const logMeta = { request_id: requestId, method, path: pathname };

      try {
        if (method === "OPTIONS") {
          logger.debug("CORS preflight", logMeta);
          return handlePreflight(request.headers.get("Origin"), corsConfig);
        }

        const contentLength = request.headers.get("Content-Length");
        if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
          return errorResponse("PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodySize} bytes limit.`, 413);
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = requestTimeoutMs > 0
          ? new Promise<Response>((_, reject) => {
              timeoutId = setTimeout(() => reject(new RequestTimeoutError()), requestTimeoutMs);
            })
          : null;

        let response: Response;
        const match = router.match(method, pathname);

        if (!match) {
          response = errorResponse("NOT_FOUND", `Route not found: ${method} ${pathname}`, 404);
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        } else {
          const handlerPromise = match.handler(request, match.params);
          try {
            response = timeoutPromise
              ? await Promise.race([handlerPromise, timeoutPromise])
              : await handlerPromise;
          } catch (err) {
            const isTimeout = err instanceof RequestTimeoutError;
            if (isTimeout) {
              logger.warn("Request timeout", logMeta);
              response = errorResponse("REQUEST_TIMEOUT", "Request timed out.", 408);
            } else {
              logger.error("Handler error", { ...logMeta, error: err instanceof Error ? err.message : "Unknown" });
              response = errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
            }
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }
        }

        const origin = request.headers.get("Origin");
        if (origin) {
          response = applyCors(response, origin, corsConfig);
        }

        const durationMs = Math.round(performance.now() - startTime);
        logger.info(`${method} ${pathname} ${response.status}`, { ...logMeta, status: response.status, duration_ms: durationMs });
        flushLogger();
        return response;
      } catch (err) {
        const origin = request.headers.get("Origin");
        let response = errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
        if (origin) response = applyCors(response, origin, corsConfig);
        return response;
      }
    },
  });

  logger.info(`Server started on http://localhost:${config.port}`, { request_id: "system" });
  return server;
}

export function stopServerBackgroundTasks(): void {
  stopLogger();
}

export { Router };
