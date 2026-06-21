import { loadConfig, type BoltstoreConfig } from "../config";
import { info, success } from "../cli-style";

export async function autoInitConfig(): Promise<BoltstoreConfig> {
  const candidates = ["boltstore.yaml", "boltstore.yml", "boltstore.json"];
  let existing: string | undefined;
  for (const candidate of candidates) {
    try {
      if (await Bun.file(candidate).exists()) {
        existing = candidate;
        break;
      }
    } catch {}
  }

  if (existing) return loadConfig();

  info("No config file found. Generating boltstore.yaml with defaults...");
  const defaults = buildDefaults();
  await Bun.write("boltstore.yaml", renderYaml(defaults));
  success("Created boltstore.yaml");
  return loadConfig();
}

interface BuildDefaults {
  port: number;
  databasePath: string;
  logLevel: string;
}

function buildDefaults(): BuildDefaults {
  return {
    port: 8080,
    databasePath: "./data",
    logLevel: "info",
  };
}

function renderYaml(cfg: ReturnType<typeof buildDefaults>): string {
  return `# Boltstore configuration
port: ${cfg.port}
databasePath: ${cfg.databasePath}
logLevel: ${cfg.logLevel}
maxBodySize: 10              # Max request body size in MB (default 10)
`;
}

export async function initCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const defaults = buildDefaults();

  if (asJson) {
    await Bun.write("boltstore.json", JSON.stringify(defaults, null, 2));
    success("Created boltstore.json");
  } else {
    await Bun.write("boltstore.yaml", renderYaml(defaults));
    success("Created boltstore.yaml");
  }
}
