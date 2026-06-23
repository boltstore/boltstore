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
import { registerTransferRoutes } from "./routes/transfer";
import { registerAdminRoutes } from "./routes/admin";
import { registerActivityRoutes, setTrustedProxies } from "./routes/activity";
import { registerSettingsRoutes } from "./routes/settings";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { AnalyticsManager } from "./analytics";

export interface ServerConfig {
  port: number;
  cors?: CorsConfig;
  manager?: DatabaseManager;
  maxBodySize?: number;
  requestTimeoutMs?: number;
  adminKey?: string;
  devDashboardUrl?: string;
  analytics?: AnalyticsManager;
  trustedProxies?: string[];
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

export async function parseJsonBody<T = unknown>(request: Request): Promise<T | Response> {
  try {
    return await request.json() as T;
  } catch {
    return errorResponse("INVALID_JSON", "Invalid or empty JSON in request body.", 400);
  }
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

export function createRouter(config: { manager?: DatabaseManager; adminKey?: string; analytics?: AnalyticsManager }): Router {
  const router = new Router();
  const manager = config.manager;
  const analytics = config.analytics;

  registerHealthRoutes(router, manager);
  if (manager) {
    registerDatabaseRoutes(router, manager);
    registerApiKeyRoutes(router, manager);
    registerTableRoutes(router, manager);
    registerRecordRoutes(router, manager);
    registerQueryRoutes(router, manager);
    registerConfigRoutes(router, manager);
    registerTransferRoutes(router, manager);
    registerAdminRoutes(router, manager, config.adminKey);
    registerActivityRoutes(router, manager);
    registerSettingsRoutes(router, manager);
    if (analytics) {
      registerAnalyticsRoutes(router, manager, analytics);
    }
  }
  return router;
}

export function createServer(config: ServerConfig): ReturnType<typeof Bun.serve> {
  const router = createRouter({ manager: config.manager, adminKey: config.adminKey, analytics: config.analytics });
  const corsConfig = config.cors || defaultCorsConfig;
  const maxBodySize = (config.maxBodySize ?? 10) * 1024 * 1024;
  const requestTimeoutMs = config.requestTimeoutMs ?? 30000;

  const trustedProxies = config.trustedProxies ?? [];
  setTrustedProxies(trustedProxies);

  const server = Bun.serve({
    port: config.port,
    async fetch(request: Request, srv?: any): Promise<Response> {
      const requestId = generateRequestId();
      const startTime = performance.now();
      const url = new URL(request.url);
      const method = request.method;
      const pathname = url.pathname;

      // Capture the direct connection IP and pass it to handlers via a header.
      // getClientIp() uses this to decide whether to trust X-Forwarded-For etc.
      let directIp: string | null = null;
      try {
        const addr = srv?.requestIP(request);
        if (addr) directIp = typeof addr === "string" ? addr : (addr as { address?: string }).address ?? null;
      } catch {}
      if (directIp) {
        request.headers.set("x-boltstore-direct-ip", directIp);
      }

      // Serve dashboard static files
      if (pathname.startsWith("/dashboard")) {
        const devUrl = config.devDashboardUrl;
        if (devUrl) {
          const targetUrl = devUrl + pathname + url.search;
          try {
            const upstream = await fetch(targetUrl, { method, headers: request.headers, body: request.body });
            return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
          } catch {
            // fall through to static files if Vite dev server is unreachable
          }
        }
        const filePath = pathname === "/dashboard" || pathname === "/dashboard/"
          ? `${import.meta.dir}/../admin/dist/index.html`
          : `${import.meta.dir}/../admin/dist${pathname.replace("/dashboard", "")}`;
        const file = Bun.file(filePath);
        const exists = await file.exists();
        if (exists) return new Response(file);
        // SPA fallback: serve index.html for all dashboard routes
        const indexFile = Bun.file(`${import.meta.dir}/../admin/dist/index.html`);
        if (await indexFile.exists()) return new Response(indexFile);
        return errorResponse("NOT_FOUND", "Dashboard not built. Run 'cd admin && npm run build'.", 404);
      }

      const logMeta = { request_id: requestId, method, path: pathname };

      try {
        if (method === "OPTIONS") {
          logger.debug("CORS preflight", logMeta);
          return handlePreflight(request.headers.get("Origin"), corsConfig);
        }

        const contentLength = request.headers.get("Content-Length");
        if (contentLength && parseInt(contentLength, 10) > maxBodySize && !pathname.startsWith("/api/databases/import")) {
          return errorResponse("PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodySize / 1024 / 1024}MB limit.`, 413);
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
