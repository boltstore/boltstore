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
import { createBackup, listBackups, restoreFromFile } from "./admin/backup";
import { createApiKey } from "./admin/api-keys";
import { bootstrapAuthTables } from "./auth";

const HELP = `
Boltstore — Lightweight backend-as-a-service

Usage: boltstore <command> [options]

Commands:
  serve                 Start the HTTP server
  init                  Generate a config file (boltstore.json)
  admin init            Create an admin API key for a database
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

      console.log(`[boltstore] Server running on http://localhost:${config.port}`);
      console.log(`[boltstore] Data directory: ${config.databasePath}`);

      process.on("SIGINT", () => { console.log("\n[boltstore] Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
      process.on("SIGTERM", () => { console.log("[boltstore] Shutting down..."); stopServerBackgroundTasks(); manager.close(); server.stop(); process.exit(0); });
      break;
    }

    case "init": {
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
        maxBodySize: 1024 * 1024,
        requestTimeoutMs: 30000,
        maxBatchSize: 1000,
        queryTimeoutMs: 0,
        trustedProxies: [],
      };

      await Bun.write("boltstore.json", JSON.stringify(config, null, 2));
      console.log("[boltstore] Created boltstore.json");
      console.warn("[boltstore] A random JWT secret was generated. In production, set a strong JWT_SECRET and keep it secret.");
      break;
    }

    case "admin": {
      const subcommand = args[1];
      if (subcommand === "init") {
        const config = await loadConfig();
        const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
        const manager = new DatabaseManager({ dataDir: config.databasePath });

        try {
          if (!manager.exists(dbName)) {
            manager.createDatabase(dbName);
          }

          const pool = manager.get(dbName);
          bootstrapAuthTables(pool);
          const key = await createApiKey(pool, "admin-cli-key", { operations: ["admin"] });

          console.log(`[boltstore] Admin API key created for database "${dbName}":`);
          console.log(`  Key:    ${key.secret}`);
          console.log(`  Prefix: ${key.prefix}`);
          console.log(`  ID:     ${key.id}`);
          console.log(`\nUse this key in the Authorization header:\n`);
          console.log(`  Authorization: Bearer ${key.secret}\n`);
          console.log("Store this key securely. It will not be shown again.");
        } finally {
          manager.close();
        }
      } else {
        console.log("Usage: boltstore admin init [--db <name>]");
      }
      break;
    }

    case "migrate": {
      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const migrationDir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "./migrations";

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        // Create the database if it doesn't exist
        if (!manager.exists(dbName)) {
          manager.createDatabase(dbName);
        }

        const pool = manager.get(dbName);
        const result = await applyMigrations(pool, migrationDir);

        if (result.applied.length === 0) {
          console.log("[boltstore] No pending migrations.");
        } else {
          console.log(`[boltstore] Applied ${result.applied.length} migration(s):`);
          for (const name of result.applied) {
            console.log(`  ✓ ${name}`);
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
          console.log(`[boltstore] Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const result = rollbackLastMigration(pool);

        if (result.rolledBack) {
          console.log(`[boltstore] Rolled back: ${result.rolledBack}`);
        } else {
          console.log("[boltstore] No migrations to roll back.");
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
          console.log(`[boltstore] Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const migrations = listMigrations(pool);

        if (migrations.length === 0) {
          console.log("[boltstore] No migrations applied.");
        } else {
          console.log(`[boltstore] Applied migrations (${migrations.length}):`);
          for (const m of migrations) {
            console.log(`  ${m.name} — ${m.appliedAt}`);
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
        console.log("Usage: boltstore import <collection> <file> [--db <path>] [--format csv|json]");
        break;
      }

      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const formatArg = args.includes("--format") ? args[args.indexOf("--format") + 1] : undefined;

      let format: "csv" | "json" | undefined;
      if (formatArg === "csv") format = "csv";
      else if (formatArg === "json") format = "json";
      else {
        // Auto-detect from file extension
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
          console.log(`[boltstore] Created collection "${collection}" with auto-detected schema.`);
        }
        console.log(`[boltstore] Imported ${result.imported} record(s).`);
        if (result.failed > 0) {
          console.log(`[boltstore] ${result.failed} row(s) failed validation.`);
          if (result.errors) {
            for (const err of result.errors) {
              console.log(`  Row ${err.row + 1}: ${err.message}`);
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
        console.log("Usage: boltstore export <collection> [--db <path>] [--format csv|json]");
        break;
      }

      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";
      const formatArg = args.includes("--format") ? args[args.indexOf("--format") + 1] : "json";
      const format: "csv" | "json" = (formatArg === "csv" ? "csv" : "json");

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          console.log(`[boltstore] Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const result = exportData(pool, collection, { format });

        if (format === "csv") {
          process.stdout.write(result.data);
        } else {
          console.log(result.data);
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
          console.log(`[boltstore] Database "${dbName}" not found.`);
          break;
        }

        const pool = manager.get(dbName);
        const result = createBackup(pool, dbName, manager.getDataDir(), { label });

        console.log(`[boltstore] Backup created: ${result.id}`);
        console.log(`  Path: ${result.path}`);
        console.log(`  Size: ${result.sizeBytes} bytes`);
        if (result.label) console.log(`  Label: ${result.label}`);
      } finally {
        manager.close();
      }
      break;
    }

    case "restore": {
      const filePath = args[1];

      if (!filePath) {
        console.log("Usage: boltstore restore <file> [--db <path>]");
        break;
      }

      const config = await loadConfig();
      const dbName = args.includes("--db") ? args[args.indexOf("--db") + 1] : "default";

      const manager = new DatabaseManager({ dataDir: config.databasePath });

      try {
        if (!manager.exists(dbName)) {
          console.log(`[boltstore] Database "${dbName}" not found.`);
          break;
        }

        const result = restoreFromFile(manager, dbName, filePath);

        console.log(`[boltstore] Restored database "${result.database}" from ${result.backupPath}`);
        console.log(`  Restored at: ${result.restoredAt}`);
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
        console.log(JSON.stringify(body.data, null, 2));
      } catch {
        console.log('[boltstore] Server is not running.');
      }
      break;
    }

    case "--help":
    case "-h":
    case "help":
    default:
      console.log(HELP);
      break;
  }
}