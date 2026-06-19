/**
 * CORS middleware — handles cross-origin requests.
 *
 * Configurable via environment variables:
 * - CORS_ORIGINS: comma-separated list of allowed origins (default: "*")
 * - CORS_METHODS: comma-separated list of allowed methods (default: "GET,POST,PATCH,DELETE,OPTIONS")
 * - CORS_HEADERS: comma-separated list of allowed headers (default: "Content-Type,Authorization")
 *
 * @module boltstore/middleware/cors
 */

export interface CorsConfig {
  origins: string[];
  methods: string[];
  headers: string[];
}

const defaultConfig: CorsConfig = {
  origins: Bun.env.CORS_ORIGINS
    ? Bun.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["*"],
  methods: (Bun.env.CORS_METHODS || "GET,POST,PATCH,DELETE,OPTIONS").split(",").map((s) => s.trim()),
  headers: (Bun.env.CORS_HEADERS || "Content-Type,Authorization").split(",").map((s) => s.trim()),
};

/**
 * Apply CORS headers to a Response object.
 * Returns the response with CORS headers set, or a 204 for preflight requests.
 */
export function applyCors(
  response: Response,
  requestOrigin: string | null,
  config: CorsConfig = defaultConfig
): Response {
  const origins = config.origins.length > 0 ? config.origins : ["*"];
  let origin: string | null = null;

  if (origins.includes("*")) {
    // When wildcard is explicitly configured, send wildcard (do not echo).
    origin = "*";
  } else if (requestOrigin && origins.includes(requestOrigin)) {
    origin = requestOrigin;
  }

  // No matching origin — return response unchanged.
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", config.methods.join(", "));
  headers.set("Access-Control-Allow-Headers", config.headers.join(", "));
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle an OPTIONS preflight request.
 * Returns a 204 No Content response with appropriate CORS headers.
 */
export function handlePreflight(requestOrigin: string | null, config: CorsConfig = defaultConfig): Response {
  const origins = config.origins.length > 0 ? config.origins : ["*"];
  let origin: string | null = null;

  if (origins.includes("*")) {
    origin = "*";
  } else if (requestOrigin && origins.includes(requestOrigin)) {
    origin = requestOrigin;
  }

  if (!origin) {
    return new Response(null, { status: 204 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": config.methods.join(", "),
      "Access-Control-Allow-Headers": config.headers.join(", "),
      "Access-Control-Max-Age": "86400",
    },
  });
}

export { defaultConfig };