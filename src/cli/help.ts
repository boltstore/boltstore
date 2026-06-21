export const HELP = `
 ⚡ boltstore — Lightweight backend-as-a-service

 Usage: boltstore <command> [options]

 Commands:
   serve                   Start the HTTP server
   init [--json]           Generate a config file (boltstore.yaml by default)

   admin                   Create an admin account interactively

   applications            List applications with their databases and file paths
   applications --create <name>            Create a new application with database
   applications --rename <database-id> <new-name>  Rename an application
   applications --delete <database-id>    Delete an application (irreversible!)

   migrate --db <database-id>             Run pending migrations
   migrate:rollback --db <database-id>    Rollback last migration
   migrate:list --db <database-id>        List migration status

   db:import <col> <file> --db <database-id>  Import data into a collection
   db:export <col> --db <database-id>     Export data from a collection (stdout)
   db:backup --db <database-id>           Create a backup snapshot
   db:restore <file> --db <database-id>   Restore from a backup file
   
   types --db <id>                  Generate TypeScript types from collection schemas
   types --db <id> --output <file>  Write generated types to a file
   
   routes                  List all API routes grouped by access tier
   status                  Display server health and stats

   bench                   Run performance benchmarks against a temp database
   bench --records <n>     Number of seed records (default: 10000)
   bench --iterations <n>  Iterations per test (default: 1000)
   bench --batch-size <n>  Records per batch (default: 100)
   bench --concurrent <n>  Concurrent request count (default: 1000)
   bench --keep-data       Keep temp database after benchmark

  Options:
   --port <number>       HTTP server port (default: 8080)
   --db <database-id>    Database ID (dbs_ prefix)
   --config <path>       Path to config file
   --log-level <level>   Log level: debug, info, warn, error
   --timezone <tz>       Server timezone
   --format <fmt>        Format for import/export: csv or json
   --help                Show this help
`;
