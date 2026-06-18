import { loadConfig } from "../config";
import { info, success, warn } from "../cli-style";

export async function autoInitConfig(): Promise<ReturnType<typeof loadConfig>> {
  const existing = ["boltstore.yaml", "boltstore.yml", "boltstore.json"].find((f) => {
    try { return Bun.file(f).exists(); } catch { return false; }
  });
  if (existing) return loadConfig();

  info("No config file found. Generating boltstore.yaml with a random JWT secret...");
  const jwtSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const yaml = `# Boltstore configuration (auto-generated)
port: 8080
databasePath: ./data
jwtSecret: "${jwtSecret}"
rateLimitPublic: 100
rateLimitAuth: 1000
rateLimitAdmin: 500
rateLimitWindowSeconds: 60
serverTimezone: UTC
corsOrigins:
corsMethods:
  - GET
  - POST
  - PATCH
  - DELETE
  - OPTIONS
corsHeaders:
  - Content-Type
  - Authorization
logLevel: info
maxBodySize: 1048576
requestTimeoutMs: 30000
maxBatchSize: 1000
queryTimeoutMs: 0
trustedProxies:
`;
  await Bun.write("boltstore.yaml", yaml);
  success("Created boltstore.yaml");
  warn("A random JWT secret was generated. In production, set a strong JWT_SECRET and keep it secret.");
  return loadConfig();
}

export async function initCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const jwtSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const config = {
    port: 8080,
    databasePath: "./data",
    jwtSecret,
    rateLimitPublic: 100,
    rateLimitAuth: 1000,
    rateLimitAdmin: 500,
    rateLimitWindowSeconds: 60,
    serverTimezone: "UTC",
    corsOrigins: [] as string[],
    corsMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    corsHeaders: ["Content-Type", "Authorization"],
    logLevel: "info",
    maxBodySize: 1048576,
    requestTimeoutMs: 30000,
    maxBatchSize: 1000,
    queryTimeoutMs: 0,
    trustedProxies: [] as string[],
  };

  if (asJson) {
    await Bun.write("boltstore.json", JSON.stringify(config, null, 2));
    success("Created boltstore.json");
  } else {
    const yaml = `# Boltstore configuration
port: ${config.port}
databasePath: ${config.databasePath}
jwtSecret: "${config.jwtSecret}"
rateLimitPublic: ${config.rateLimitPublic}
rateLimitAuth: ${config.rateLimitAuth}
rateLimitAdmin: ${config.rateLimitAdmin}
rateLimitWindowSeconds: ${config.rateLimitWindowSeconds}
serverTimezone: ${config.serverTimezone}
corsOrigins:
corsMethods:
  - GET
  - POST
  - PATCH
  - DELETE
  - OPTIONS
corsHeaders:
  - Content-Type
  - Authorization
logLevel: ${config.logLevel}
maxBodySize: ${config.maxBodySize}
requestTimeoutMs: ${config.requestTimeoutMs}
maxBatchSize: ${config.maxBatchSize}
queryTimeoutMs: ${config.queryTimeoutMs}
trustedProxies:
`;
    await Bun.write("boltstore.yaml", yaml);
    success("Created boltstore.yaml");
  }

  warn("A random JWT secret was generated. In production, set a strong JWT_SECRET and keep it secret.");
}
