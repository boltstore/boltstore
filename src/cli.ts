/**
 * CLI entry point for Boltstore.
 *
 * Provides commands for starting the server, managing the database,
 * and performing administrative tasks.
 *
 * Usage: boltstore <command> [options]
 *
 * @module boltstore/cli
 */

import { DatabaseManager } from "./db/manager";
import { createServer, stopServerBackgroundTasks } from "./server";
import { loadConfig } from "./config";
import { listMigrations, applyMigrations, rollbackLastMigration } from "./migrations";
import { importData, exportData } from "./admin/import-export";
import { createBackup, restoreFromFile } from "./admin/backup";
import { createAdminUser } from "./auth/users";
import { info, success, warn, error as cliError, out } from "./cli-style";

const HELP = `
 ⚡ boltstore — Lightweight backend-as-a-service

 Usage: boltstore <command> [options]

 Commands:
   serve                 Start the HTTP server
   init [--json]         Generate a config file (boltstore.yaml by default)
   admin init            Create an admin account interactively
   migrate [--db <path>] [--dir <path>]  Run pending migrations
   migrate:rollback [--db <path>]        Rollback last migration
   migrations [--db <path>]              List migration status
   import <collection> <file> [--db <path>] [--format csv|json]  Import data
   export <collection> [--db <path>] [--format csv|json]         Export data (stdout)
   backup [--db <path>] [--label <text>]   Create a backup snapshot
   restore <file> [--db <path>]            Restore from a backup file
   status                                  Display server health and stats

 Options:
   --port <number>       HTTP server port (default: 8080)
   --db <path>           Database path or data directory
   --config <path>       Path to config file
   --log-level <level>   Log level: debug, info, warn, error
   --timezone <tz>       Server timezone
   --format <fmt>        Format for import/export: csv or json
   --help                Show this help
`;

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];

  // Commands that don't require a config file
  const NO_CONFIG_COMMANDS = new Set(["init", "help", "--help", "-h"]);

  if (!NO_CONFIG_COMMANDS.has(command)) {
    let configExists = false;
    for (const candidate of ["boltstore.yaml", "boltstore.yml", "boltstore.json"]) {
      try {
        if (await Bun.file(candidate).exists()) {
          configExists = true;
          break;
        }
      } catch {
        // Skip
      }
    }
    if (!configExists) {
      cliError("No config file found. Run boltstore init first to create one.");
      process.exit(1);
    }
  }

  switch (command) {
    case "serve": {
      const config = await loadConfig();
      const manager = new DatabaseManager({ dataDir: config.databasePath });

      const server = createServer({
        port: config.port,
        manager,
        auth: { secret: config.jwtSecret },
        cors: {
          origins: config.corsOrigins,
          methods: config.corsMethods,
          headers: config.corsHeaders,
        },
        rateLimit: {
          public: config.rateLimitPublic,
          auth: config.rateLimitAuth,
          admin: config.rateLimitAdmin,
          windowSeconds: config.rateLimitWindowSeconds,
        },
        maxBodySize: config.maxBodySize,
        requestTimeoutMs: config.requestTimeoutMs,
        maxBatchSize: config.maxBatchSize,
        trustedProxies: config.trustedProxies,
      });

      info(`Server running on http://localhost:${config.port}`);
      info(`Data directory: ${config.databasePath}`);

      process.on("SIGINT", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
      process.on("SIGTERM", () => { info("Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
      break;
    }

    case "init": {
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
        corsOrigins: [],
        corsMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        corsHeaders: ["Content-Type", "Authorization"],
        logLevel: "info",
        maxBodySize: 1048576,
        requestTimeoutMs: 30000,
        maxBatchSize: 1000,
        queryTimeoutMs: 0,
        trustedProxies: [],
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
      break;
    }

    case "admin": {
      const subcommand = args[1];
      if (subcommand === "init") {
        const { prompt, promptPassword } = await import("./prompt");

        out("");
        info("Create an admin account for the Boltstore server.");

        const name = (await prompt("  Name (optional): ")) || undefined;
        const email = await prompt("  Email: ");
        const password = await promptPassword("  Password (min 8 chars): ");

        if (!email || !password) {
          cliError("Email and password are required.");
          break;
        }

        const config = await loadConfig();
        const manager = new DatabaseManager({ dataDir: config.databasePath });

        try {
          const metaPool = manager.getMetaPool();
          const user = await createAdminUser(metaPool, email.trim(), password, name?.trim() || undefined);

          out("");
          success(`Admin account created (source: ${user.source}).`);
          out(`  ID:    ${user.id}`);
          out(`  Email: ${user.email}`);
          if (user.name) out(`  Name:  ${user.name}`);
          out("");
          info("You can now log in at POST /api/_system/auth/login");
          out(`  { "email": "${user.email}", "password": "..." }`);
          out("");
        } finally {
          manager.close();
        }
      } else {
        cliError("Usage: boltstore admin init");
      }
      break;
    }

    case "migrate": {
      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const migrationDir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "./migrations";

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          manager.createDatabase(dbName);
        }

        const pool = manager.get(dbName);
        const result = await applyMigrations(pool, migrationDir);

        if (result.applied.length === 0) {
          info("No pending migrations.");
        } else {
          success(`Applied ${result.applied.length} migration(s):`);
          for (const name of result.applied) {
            out(`  ✓ ${name}`);
          }
        }
      } finally {
        manager.close();
      }
      break;
    }

    case "migrate:rollback": {
      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          cliError(`Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const result = rollbackLastMigration(pool);

        if (result.rolledBack) {
          success(`Rolled back: ${result.rolledBack}`);
        } else {
          info("No migrations to roll back.");
        }
      } finally {
        manager.close();
      }
      break;
    }

    case "migrations": {
      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          cliError(`Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const migrations = listMigrations(pool);

        if (migrations.length === 0) {
          info("No migrations applied.");
        } else {
          out(`Applied migrations (${migrations.length}):`);
          for (const m of migrations) {
            out(`  ${m.name} — ${m.appliedAt}`);
          }
        }
      } finally {
        manager.close();
      }
      break;
    }

    case "import": {
      const collection = args[1];
      const filePath = args[2];

      if (!collection || !filePath) {
        cliError("Usage: boltstore import <collection> <file> [--db <path>] [--format csv|json]");
        break;
      }

      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const formatArg = args.includes("--format") ? args[args.indexOf("--format") + 1] : undefined;

      let format: "csv" | "json" | undefined;
      if (formatArg === "csv") format = "csv";
      else if (formatArg === "json") format = "json";
      else {
        if (filePath.endsWith(".csv")) format = "csv";
        else format = "json";
      }

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          manager.createDatabase(dbName);
        }

        const input = await Bun.file(filePath).text();
        const pool = manager.get(dbName);
        const result = importData(pool, collection, input, { format, autoCreate: true });

        if (result.collection) {
          info(`Created collection "${collection}" with auto-detected schema.`);
        }
        success(`Imported ${result.imported} record(s).`);
        if (result.failed > 0) {
          warn(`${result.failed} row(s) failed validation.`);
          if (result.errors) {
            for (const err of result.errors) {
              cliError(`Row ${err.row + 1}: ${err.message}`);
            }
          }
        }
      } finally {
        manager.close();
      }
      break;
    }

    case "export": {
      const collection = args[1];

      if (!collection) {
        cliError("Usage: boltstore export <collection> [--db <path>] [--format csv|json]");
        break;
      }

      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const formatArg = args.includes("--format") ? args[args.indexOf("--format") + 1] : "json";
      const format: "csv" | "json" = (formatArg === "csv" ? "csv" : "json");

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          cliError(`Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const result = exportData(pool, collection, { format });

        if (format === "csv") {
          process.stdout.write(result.data);
        } else {
          out(result.data);
        }
      } finally {
        manager.close();
      }
      break;
    }

    case "backup": {
      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : undefined;

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          cliError(`Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const result = createBackup(pool, dbName, manager.getDataDir(), { label });

        success(`Backup created: ${result.id}`);
        out(`  Path: ${result.path}`);
        out(`  Size: ${result.sizeBytes} bytes`);
        if (result.label) out(`  Label: ${result.label}`);
      } finally {
        manager.close();
      }
      break;
    }

    case "restore": {
      const filePath = args[1];

      if (!filePath) {
        cliError("Usage: boltstore restore <file> [--db <path>]");
        break;
      }

      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          cliError(`Database "${dbName}" not found.`);
          break;
        }

        const result = restoreFromFile(manager, dbName, filePath);

        success(`Restored database "${result.database}" from ${result.backupPath}`);
        out(`  Restored at: ${result.restoredAt}`);
      } finally {
        manager.close();
      }
      break;
    }

    case "status": {
      const config = await loadConfig();
      const healthUrl = `http://localhost:${config.port}/api/health`;

      try {
        const response = await fetch(healthUrl);
        const body = await response.json();
        out(JSON.stringify(body.data, null, 2));
      } catch {
        cliError("Server is not running.");
      }
      break;
    }

    case "--help":
    case "-h":
    case "help":
    default:
      out(HELP);
      break;
  }
}