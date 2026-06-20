/**
 * Configuration loader for Boltstore.
 *
 * Three sources, merged in priority order:
 * 1. CLI flags (highest priority)
 * 2. Environment variables
 * 3. Config file (YAML or JSON)
 *
 * @module boltstore/config
 */

import { parseYaml } from "./yaml";

export interface BoltstoreConfig {
  port: number;
  databasePath: string;
  jwtSecret?: string;
  /** Requests per minute for public endpoints. Default: 100. */
  rateLimitPublic: number;
  /** Requests per minute for authenticated endpoints. Default: 1000. */
  rateLimitAuth: number;
  /** Requests per minute for admin endpoints. Default: 500. */
  rateLimitAdmin: number;
  /** Rate limit window in seconds. Default: 60. */
  rateLimitWindowSeconds: number;
  serverTimezone: string;
  corsOrigins: string[];
  corsMethods: string[];
  corsHeaders: string[];
  logLevel: string;
  /** Maximum request body size in bytes. Default: 1 MB. */
  maxBodySize: number;
  /** Request handler timeout in milliseconds. Default: 30000. */
  requestTimeoutMs: number;
  /** Maximum number of operations in a single transaction/batch. Default: 1000. */
  maxBatchSize: number;
  /** SQLite query timeout in milliseconds. 0 disables. Default: 0. */
  queryTimeoutMs: number;
  /** Optional list of trusted proxy IPs/CIDRs. */
  trustedProxies: string[];
  /** Maximum number of rows accepted by the import endpoint. Default: 100000. */
  maxImportRows: number;
  /** Enable realtime WebSocket subscriptions. Default: false. */
  enableRealtime: boolean;
  /** Enable offline sync (push/pull/CDC). Default: false. */
  enableSync: boolean;
}

const DEFAULT_CONFIG: BoltstoreConfig = {
  port: 8080,
  databasePath: "./data",
  rateLimitPublic: 100,
  rateLimitAuth: 1000,
  rateLimitAdmin: 500,
  rateLimitWindowSeconds: 60,
  serverTimezone: "UTC",
  corsOrigins: ["*"],
  corsMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  corsHeaders: ["Content-Type", "Authorization"],
  logLevel: "info",
  maxBodySize: 1024 * 1024,
  requestTimeoutMs: 30000,
  maxBatchSize: 1000,
  maxImportRows: parseInt(Bun.env.MAX_IMPORT_ROWS || "100000", 10) || 100000,
  queryTimeoutMs: parseInt(Bun.env.QUERY_TIMEOUT_MS || "0", 10) || 0,
  trustedProxies: [],
  enableRealtime: false,
  enableSync: false,
};

/**
 * Parse CLI flags from process.argv.
 * Supports: --port, --db, --config, --jwt-secret, --rate-limit-public, --rate-limit-auth, --rate-limit-admin, --rate-limit-window, --timezone, --log-level, --max-body-size, --request-timeout, --max-batch-size, --query-timeout, --trusted-proxies
 */
function parseCliArgs(): Partial<BoltstoreConfig> {
  const config: Partial<BoltstoreConfig> = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--port":
        if (next) { config.port = parseInt(next, 10); i++; }
        break;
      case "--db":
        if (next) { config.databasePath = next; i++; }
        break;
      case "--config":
        if (next) { i++; /* handled separately */ }
        break;
      case "--jwt-secret":
        if (next) { config.jwtSecret = next; i++; }
        break;
      case "--rate-limit-public":
        if (next) { config.rateLimitPublic = parseInt(next, 10); i++; }
        break;
      case "--rate-limit-auth":
        if (next) { config.rateLimitAuth = parseInt(next, 10); i++; }
        break;
      case "--rate-limit-admin":
        if (next) { config.rateLimitAdmin = parseInt(next, 10); i++; }
        break;
      case "--rate-limit-window":
        if (next) { config.rateLimitWindowSeconds = parseInt(next, 10); i++; }
        break;
      case "--timezone":
        if (next) { config.serverTimezone = next; i++; }
        break;
      case "--log-level":
        if (next) { config.logLevel = next; i++; }
        break;
      case "--max-body-size":
        if (next) { config.maxBodySize = parseInt(next, 10); i++; }
        break;
      case "--request-timeout":
        if (next) { config.requestTimeoutMs = parseInt(next, 10); i++; }
        break;
      case "--max-batch-size":
        if (next) { config.maxBatchSize = parseInt(next, 10); i++; }
        break;
      case "--query-timeout":
        if (next) { config.queryTimeoutMs = parseInt(next, 10); i++; }
        break;
      case "--trusted-proxies":
        if (next) { config.trustedProxies = next.split(",").map((s) => s.trim()).filter(Boolean); i++; }
        break;
      case "--max-import-rows":
        if (next) { config.maxImportRows = parseInt(next, 10); i++; }
        break;
    }
  }

  return config;
}

/**
 * Parse environment variables.
 */
function parseEnvVars(): Partial<BoltstoreConfig> {
  const config: Partial<BoltstoreConfig> = {};

  if (Bun.env.PORT) config.port = parseInt(Bun.env.PORT, 10);
  if (Bun.env.DATABASE_PATH) config.databasePath = Bun.env.DATABASE_PATH;
  if (Bun.env.JWT_SECRET) config.jwtSecret = Bun.env.JWT_SECRET;
  if (Bun.env.RATE_LIMIT_PUBLIC) config.rateLimitPublic = parseInt(Bun.env.RATE_LIMIT_PUBLIC, 10);
  if (Bun.env.RATE_LIMIT_AUTH) config.rateLimitAuth = parseInt(Bun.env.RATE_LIMIT_AUTH, 10);
  if (Bun.env.RATE_LIMIT_ADMIN) config.rateLimitAdmin = parseInt(Bun.env.RATE_LIMIT_ADMIN, 10);
  if (Bun.env.RATE_LIMIT_WINDOW_SECONDS) config.rateLimitWindowSeconds = parseInt(Bun.env.RATE_LIMIT_WINDOW_SECONDS, 10);
  if (Bun.env.SERVER_TIMEZONE) config.serverTimezone = Bun.env.SERVER_TIMEZONE;
  if (Bun.env.CORS_ORIGINS) config.corsOrigins = Bun.env.CORS_ORIGINS.split(",").map((s) => s.trim());
  if (Bun.env.CORS_METHODS) config.corsMethods = Bun.env.CORS_METHODS.split(",").map((s) => s.trim());
  if (Bun.env.CORS_HEADERS) config.corsHeaders = Bun.env.CORS_HEADERS.split(",").map((s) => s.trim());
  if (Bun.env.LOG_LEVEL) config.logLevel = Bun.env.LOG_LEVEL;
  if (Bun.env.MAX_BODY_SIZE) config.maxBodySize = parseInt(Bun.env.MAX_BODY_SIZE, 10);
  if (Bun.env.REQUEST_TIMEOUT_MS) config.requestTimeoutMs = parseInt(Bun.env.REQUEST_TIMEOUT_MS, 10);
  if (Bun.env.MAX_BATCH_SIZE) config.maxBatchSize = parseInt(Bun.env.MAX_BATCH_SIZE, 10);
  if (Bun.env.QUERY_TIMEOUT_MS) config.queryTimeoutMs = parseInt(Bun.env.QUERY_TIMEOUT_MS, 10);
  if (Bun.env.TRUSTED_PROXIES) config.trustedProxies = Bun.env.TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean);
  if (Bun.env.MAX_IMPORT_ROWS) config.maxImportRows = parseInt(Bun.env.MAX_IMPORT_ROWS, 10);
  if (Bun.env.ENABLE_REALTIME === "true") config.enableRealtime = true;
  if (Bun.env.ENABLE_SYNC === "true") config.enableSync = true;

  return config;
}

/**
 * Parse a config file (JSON or YAML) into a typed partial config.
 * Format is detected by file extension.
 */
async function parseConfigFile(filePath: string): Promise<Partial<BoltstoreConfig>> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return {};

    const content = await file.text();

    // Detect format from extension
    const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
    const parsed: Record<string, unknown> = isYaml ? parseYaml(content) : JSON.parse(content);

    return mapToConfig(parsed);
  } catch {
    return {};
  }
}

/** Map a parsed object to typed BoltstoreConfig fields. */
function mapToConfig(parsed: Record<string, unknown>): Partial<BoltstoreConfig> {
  const config: Partial<BoltstoreConfig> = {};

  if (typeof parsed.port === "number") config.port = parsed.port;
  if (typeof parsed.databasePath === "string") config.databasePath = parsed.databasePath;
  if (typeof parsed.jwtSecret === "string") config.jwtSecret = parsed.jwtSecret;
  if (typeof parsed.rateLimitPublic === "number") config.rateLimitPublic = parsed.rateLimitPublic;
  if (typeof parsed.rateLimitAuth === "number") config.rateLimitAuth = parsed.rateLimitAuth;
  if (typeof parsed.rateLimitAdmin === "number") config.rateLimitAdmin = parsed.rateLimitAdmin;
  if (typeof parsed.rateLimitWindowSeconds === "number") config.rateLimitWindowSeconds = parsed.rateLimitWindowSeconds;
  if (typeof parsed.serverTimezone === "string") config.serverTimezone = parsed.serverTimezone;
  if (Array.isArray(parsed.corsOrigins)) config.corsOrigins = parsed.corsOrigins as string[];
  if (Array.isArray(parsed.corsMethods)) config.corsMethods = parsed.corsMethods as string[];
  if (Array.isArray(parsed.corsHeaders)) config.corsHeaders = parsed.corsHeaders as string[];
  if (typeof parsed.logLevel === "string") config.logLevel = parsed.logLevel;
  if (typeof parsed.maxBodySize === "number") config.maxBodySize = parsed.maxBodySize;
  if (typeof parsed.requestTimeoutMs === "number") config.requestTimeoutMs = parsed.requestTimeoutMs;
  if (typeof parsed.maxBatchSize === "number") config.maxBatchSize = parsed.maxBatchSize;
  if (typeof parsed.queryTimeoutMs === "number") config.queryTimeoutMs = parsed.queryTimeoutMs;
  if (Array.isArray(parsed.trustedProxies)) config.trustedProxies = parsed.trustedProxies as string[];
  if (typeof parsed.maxImportRows === "number") config.maxImportRows = parsed.maxImportRows;
  if (typeof parsed.enableRealtime === "boolean") config.enableRealtime = parsed.enableRealtime;
  if (typeof parsed.enableSync === "boolean") config.enableSync = parsed.enableSync;

  return config;
}

/**
 * Load configuration from all three sources, merged in priority order.
 *
 * Priority: CLI flags > environment variables > config file > defaults
 */
export async function loadConfig(): Promise<BoltstoreConfig> {
  // Get config file path: CLI flag > env var > auto-detect boltstore.yaml / boltstore.json
  const cliArgs = process.argv.slice(2);
  const configFlagIdx = cliArgs.indexOf("--config");
  let configPath: string | undefined =
    configFlagIdx >= 0 && cliArgs[configFlagIdx + 1]
      ? cliArgs[configFlagIdx + 1]
      : Bun.env.BOLTSTORE_CONFIG;

  // Auto-detect boltstore.yaml or boltstore.json if no explicit path given
  if (!configPath) {
    for (const candidate of ["boltstore.yaml", "boltstore.yml", "boltstore.json"]) {
      try {
        if (await Bun.file(candidate).exists()) {
          configPath = candidate;
          break;
        }
      } catch {
        // File doesn't exist or can't be read — skip
      }
    }
  }


  // Load from file
  const fileConfig = configPath ? await parseConfigFile(configPath) : {};

  // Load from environment
  const envConfig = parseEnvVars();

  // Load from CLI
  const cliConfig = parseCliArgs();

  // Merge: defaults < file < env < cli
  const merged: BoltstoreConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...cliConfig,
  };

  // Validate
  if (!merged.port || merged.port < 1 || merged.port > 65535) {
    throw new Error(`Invalid port: ${merged.port}. Must be between 1 and 65535.`);
  }
  if (!merged.databasePath) {
    throw new Error("Database path is required.");
  }
  if (!merged.jwtSecret || merged.jwtSecret.length < 32) {
    throw new Error(
      "JWT secret is required and must be at least 32 characters long. Set JWT_SECRET environment variable or add jwtSecret to your config file."
    );
  }

  return merged;
}