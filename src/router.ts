/**
 * URL router for Boltstore — matches URL patterns and dispatches to handlers.
 *
 * @module boltstore/router
 */

export interface RouteHandler {
  (request: Request, params: Record<string, string>): Response | Promise<Response>;
}

export type RouteHandlerWithError = (
  request: Request,
  params: Record<string, string>
) => Response | Promise<Response>;

/** Wrap a route handler so all errors are caught and passed to a resolver. */
export function wrapRoute(
  handler: RouteHandler,
  onError: (err: unknown, request: Request) => Response
): RouteHandler {
  return async (request, params) => {
    try {
      return await handler(request, params);
    } catch (err) {
      return onError(err, request);
    }
  };
}

/** Default safe error factory used by `wrapRoute` when no resolver is provided. */
export function defaultRouteError(err: unknown): Response {
  const status = err instanceof Error ? (err as { status?: number }).status : undefined;
  const isOperational = typeof status === "number";
  const message = isOperational ? (err as Error).message : "An unexpected error occurred.";
  const code = isOperational ? "REQUEST_ERROR" : "INTERNAL_ERROR";
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status: isOperational ? status : 500, headers: { "Content-Type": "application/json" } }
  );
}

interface Route {
  method: string;
  pattern: string;
  paramNames: string[];
  regex: RegExp;
  handler: RouteHandler;
}

/**
 * A simple URL pattern router for Bun.serve.
 *
 * Inspired by pattern matching in Express/Koa, but zero dependencies.
 * Supports :param placeholders in URL paths.
 */
export class Router {
  private routes: Route[] = [];

  /**
   * Register a GET route.
   */
  get(pattern: string, handler: RouteHandler): void {
    this.addRoute("GET", pattern, handler);
  }

  /**
   * Register a POST route.
   */
  post(pattern: string, handler: RouteHandler): void {
    this.addRoute("POST", pattern, handler);
  }

  /**
   * Register a PATCH route.
   */
  patch(pattern: string, handler: RouteHandler): void {
    this.addRoute("PATCH", pattern, handler);
  }

  /**
   * Register a DELETE route.
   */
  delete(pattern: string, handler: RouteHandler): void {
    this.addRoute("DELETE", pattern, handler);
  }

  /**
   * Register a route for any HTTP method.
   */
  any(pattern: string, handler: RouteHandler, method?: string): void {
    if (method) {
      this.addRoute(method.toUpperCase(), pattern, handler);
    } else {
      // Register for all common methods
      for (const m of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
        this.addRoute(m, pattern, handler);
      }
    }
  }

  /**
   * Match a request to a registered route and execute the handler.
   * Returns null if no route matches.
   */
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = pathname.match(route.regex);
      if (!match) continue;

      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = decodeURIComponent(match[i + 1] || "");
      }

      return { handler: route.handler, params };
    }

    return null;
  }

  private addRoute(method: string, pattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });

    const regex = new RegExp(`^${regexStr}$`);
    const safeHandler = wrapRoute(handler, defaultRouteError);
    this.routes.push({ method, pattern, paramNames, regex, handler: safeHandler });
  }
}

export default Router;