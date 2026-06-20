import { loadConfig } from "../config";
import { info, success, warn } from "../cli-style";

export async function autoInitConfig(): Promise<ReturnType<typeof loadConfig>> {
  const candidates = ["boltstore.yaml", "boltstore.yml", "boltstore.json"];
  let existing: string | undefined;
  for (const candidate of candidates) {
    try {
      if (await Bun.file(candidate).exists()) {
        existing = candidate;
        break;
      }
    } catch {
      // Skip unreadable paths
    }
  }

  if (existing) {
    try {
      return loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("JWT secret")) {
        info(`Config file found but JWT secret is missing or too short. Regenerating ${existing} with defaults...`);
        const jwtSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const defaults = buildDefaults(jwtSecret);
        if (existing.endsWith(".json")) {
          await Bun.write(existing, JSON.stringify(defaults, null, 2));
        } else {
          await Bun.write(existing, renderYaml(defaults));
        }
        success(`Regenerated ${existing} with defaults and a new JWT secret.`);
        warn("A random JWT secret was generated. In production, set a strong JWT_SECRET and keep it secret.");
        return defaults;
      }
      throw err;
    }
  }

  info("No config file found. Generating boltstore.yaml with defaults...");
  const jwtSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const defaults = buildDefaults(jwtSecret);
  await Bun.write("boltstore.yaml", renderYaml(defaults));
  success("Created boltstore.yaml");
  warn("A random JWT secret was generated. In production, set a strong JWT_SECRET and keep it secret.");
  return defaults;
}

function buildDefaults(jwtSecret: string) {
  return {
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
    maxImportRows: 100000,
    enableRealtime: false,
    enableSync: false,
  };
}

function renderYaml(cfg: ReturnType<typeof buildDefaults>): string {
  return `# Boltstore configuration
port: ${cfg.port}
databasePath: ${cfg.databasePath}
jwtSecret: "${cfg.jwtSecret}"
rateLimitPublic: ${cfg.rateLimitPublic}
rateLimitAuth: ${cfg.rateLimitAuth}
rateLimitAdmin: ${cfg.rateLimitAdmin}
rateLimitWindowSeconds: ${cfg.rateLimitWindowSeconds}
serverTimezone: ${cfg.serverTimezone}
corsOrigins:
  - "*"
corsMethods:
  - GET
  - POST
  - PATCH
  - DELETE
  - OPTIONS
corsHeaders:
  - Content-Type
  - Authorization
logLevel: ${cfg.logLevel}
maxBodySize: ${cfg.maxBodySize}
requestTimeoutMs: ${cfg.requestTimeoutMs}
maxBatchSize: ${cfg.maxBatchSize}
queryTimeoutMs: ${cfg.queryTimeoutMs}
trustedProxies:
# Enable realtime WebSocket subscriptions (default: false)
# enableRealtime: false
# Enable offline sync with change tracking (default: false)
# enableSync: false
`;
}

export async function initCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const jwtSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const defaults = buildDefaults(jwtSecret);

  if (asJson) {
    await Bun.write("boltstore.json", JSON.stringify(defaults, null, 2));
    success("Created boltstore.json");
  } else {
    await Bun.write("boltstore.yaml", renderYaml(defaults));
    success("Created boltstore.yaml");
  }

  warn("A random JWT secret was generated. In production, set a strong JWT_SECRET and keep it secret.");
}
