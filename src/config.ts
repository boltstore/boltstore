import { parseYaml } from "./yaml";

export interface BoltstoreConfig {
  port: number;
  databasePath: string;
  logLevel: string;
  corsOrigins: string[];
  corsMethods: string[];
  corsHeaders: string[];
  maxBodySize: number;
  requestTimeoutMs: number;
  trustedProxies: string[];
  adminKey?: string;
}

const DEFAULT_CONFIG: BoltstoreConfig = {
  port: 8080,
  databasePath: "./data",
  corsOrigins: ["*"],
  corsMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  corsHeaders: ["Content-Type", "Authorization"],
  logLevel: "info",
  maxBodySize: 10, // MB
  requestTimeoutMs: 30000,
  trustedProxies: [],
};

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
        if (next) { i++; }
        break;
      case "--admin-key":
        if (next) { config.adminKey = next; i++; }
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
      case "--trusted-proxies":
        if (next) { config.trustedProxies = next.split(",").map((s) => s.trim()).filter(Boolean); i++; }
        break;
    }
  }

  return config;
}

function parseEnvVars(): Partial<BoltstoreConfig> {
  const config: Partial<BoltstoreConfig> = {};

  if (Bun.env.PORT) config.port = parseInt(Bun.env.PORT, 10);
  if (Bun.env.DATABASE_PATH) config.databasePath = Bun.env.DATABASE_PATH;
  if (Bun.env.BOLTSTORE_ADMIN_KEY) config.adminKey = Bun.env.BOLTSTORE_ADMIN_KEY;
  if (Bun.env.LOG_LEVEL) config.logLevel = Bun.env.LOG_LEVEL;
  if (Bun.env.MAX_BODY_SIZE) config.maxBodySize = parseInt(Bun.env.MAX_BODY_SIZE, 10);
  if (Bun.env.REQUEST_TIMEOUT_MS) config.requestTimeoutMs = parseInt(Bun.env.REQUEST_TIMEOUT_MS, 10);
  if (Bun.env.TRUSTED_PROXIES) config.trustedProxies = Bun.env.TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean);

  return config;
}

async function parseConfigFile(filePath: string): Promise<Partial<BoltstoreConfig>> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return {};

    const content = await file.text();
    const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
    const parsed: Record<string, unknown> = isYaml ? parseYaml(content) : JSON.parse(content);
    return mapToConfig(parsed);
  } catch {
    return {};
  }
}

function mapToConfig(parsed: Record<string, unknown>): Partial<BoltstoreConfig> {
  const config: Partial<BoltstoreConfig> = {};

  if (typeof parsed.adminKey === "string") config.adminKey = parsed.adminKey;
  if (typeof parsed.port === "number") config.port = parsed.port;
  if (typeof parsed.databasePath === "string") config.databasePath = parsed.databasePath;
  if (typeof parsed.logLevel === "string") config.logLevel = parsed.logLevel;
  if (Array.isArray(parsed.corsOrigins)) config.corsOrigins = parsed.corsOrigins as string[];
  if (Array.isArray(parsed.corsMethods)) config.corsMethods = parsed.corsMethods as string[];
  if (Array.isArray(parsed.corsHeaders)) config.corsHeaders = parsed.corsHeaders as string[];
  if (typeof parsed.maxBodySize === "number") config.maxBodySize = parsed.maxBodySize;
  if (typeof parsed.requestTimeoutMs === "number") config.requestTimeoutMs = parsed.requestTimeoutMs;
  if (Array.isArray(parsed.trustedProxies)) config.trustedProxies = parsed.trustedProxies as string[];

  return config;
}

export async function loadConfig(): Promise<BoltstoreConfig> {
  const cliArgs = process.argv.slice(2);
  const configFlagIdx = cliArgs.indexOf("--config");
  let configPath: string | undefined =
    configFlagIdx >= 0 && cliArgs[configFlagIdx + 1]
      ? cliArgs[configFlagIdx + 1]
      : Bun.env.BOLTSTORE_CONFIG;

  if (!configPath) {
    for (const candidate of ["boltstore.yaml", "boltstore.yml", "boltstore.json"]) {
      try {
        if (await Bun.file(candidate).exists()) {
          configPath = candidate;
          break;
        }
      } catch {}
    }
  }

  const fileConfig = configPath ? await parseConfigFile(configPath) : {};
  const envConfig = parseEnvVars();
  const cliConfig = parseCliArgs();

  const merged: BoltstoreConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...cliConfig,
  };

  if (!merged.port || merged.port < 1 || merged.port > 65535) {
    throw new Error(`Invalid port: ${merged.port}. Must be between 1 and 65535.`);
  }
  if (!merged.databasePath) {
    throw new Error("Database path is required.");
  }

  return merged;
}
