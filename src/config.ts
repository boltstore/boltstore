/**
 * Configuration loader for Boltstore.
 *
 * Three sources, merged in priority order:
 * 1. CLI flags (highest priority)
 * 2. Environment variables
 * 3. Config file (JSON)
 *
 * @module boltstore/config
 */

export interface BoltstoreConfig {
  port: number;
  databasePath: string;
  jwtSecret?: string;
  rateLimitPublic: number;
  rateLimitAuth: number;
  serverTimezone: string;
  corsOrigins: string[];
  corsMethods: string[];
  corsHeaders: string[];
  logLevel: string;
}

const DEFAULT_CONFIG: BoltstoreConfig = {
  port: 8080,
  databasePath: "./data",
  rateLimitPublic: 100,
  rateLimitAuth: 1000,
  serverTimezone: "UTC",
  corsOrigins: ["*"],
  corsMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  corsHeaders: ["Content-Type", "Authorization"],
  logLevel: "info",
};

/**
 * Parse CLI flags from process.argv.
 * Supports: --port, --db, --config, --jwt-secret, --rate-limit-public, --rate-limit-auth, --timezone, --log-level
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
      case "--timezone":
        if (next) { config.serverTimezone = next; i++; }
        break;
      case "--log-level":
        if (next) { config.logLevel = next; i++; }
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
  if (Bun.env.SERVER_TIMEZONE) config.serverTimezone = Bun.env.SERVER_TIMEZONE;
  if (Bun.env.CORS_ORIGINS) config.corsOrigins = Bun.env.CORS_ORIGINS.split(",").map((s) => s.trim());
  if (Bun.env.CORS_METHODS) config.corsMethods = Bun.env.CORS_METHODS.split(",").map((s) => s.trim());
  if (Bun.env.CORS_HEADERS) config.corsHeaders = Bun.env.CORS_HEADERS.split(",").map((s) => s.trim());
  if (Bun.env.LOG_LEVEL) config.logLevel = Bun.env.LOG_LEVEL;

  return config;
}

/**
 * Parse a JSON config file.
 */
async function parseConfigFile(filePath: string): Promise<Partial<BoltstoreConfig>> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return {};

    const content = await file.text();
    const parsed = JSON.parse(content);

    const config: Partial<BoltstoreConfig> = {};
    if (typeof parsed.port === "number") config.port = parsed.port;
    if (typeof parsed.databasePath === "string") config.databasePath = parsed.databasePath;
    if (typeof parsed.jwtSecret === "string") config.jwtSecret = parsed.jwtSecret;
    if (typeof parsed.rateLimitPublic === "number") config.rateLimitPublic = parsed.rateLimitPublic;
    if (typeof parsed.rateLimitAuth === "number") config.rateLimitAuth = parsed.rateLimitAuth;
    if (typeof parsed.serverTimezone === "string") config.serverTimezone = parsed.serverTimezone;
    if (Array.isArray(parsed.corsOrigins)) config.corsOrigins = parsed.corsOrigins;
    if (Array.isArray(parsed.corsMethods)) config.corsMethods = parsed.corsMethods;
    if (Array.isArray(parsed.corsHeaders)) config.corsHeaders = parsed.corsHeaders;
    if (typeof parsed.logLevel === "string") config.logLevel = parsed.logLevel;

    return config;
  } catch {
    return {};
  }
}

/**
 * Load configuration from all three sources, merged in priority order.
 *
 * Priority: CLI flags > environment variables > config file > defaults
 */
export async function loadConfig(): Promise<BoltstoreConfig> {
  // Get config file path from CLI or env
  const cliArgs = process.argv.slice(2);
  const configFlagIdx = cliArgs.indexOf("--config");
  const configPath =
    configFlagIdx >= 0 && cliArgs[configFlagIdx + 1]
      ? cliArgs[configFlagIdx + 1]
      : Bun.env.BOLTSTORE_CONFIG;

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

  return merged;
}