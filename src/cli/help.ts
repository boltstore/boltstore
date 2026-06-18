import { warn } from "../cli-style";

export const HELP = `
 ⚡ boltstore — Lightweight backend-as-a-service

 Usage: boltstore <command> [options]

 Commands:
   serve                   Start the HTTP server
   init [--json]           Generate a config file (boltstore.yaml by default)
   admin                   Create an admin account interactively
   applications            List applications with their databases and file paths
   applications --create <name>            Create a new application with database
   applications --rename <app> <new-name>  Rename an application
   applications --delete <app>             Delete an application (irreversible!)
   migrate                 Run pending migrations
   migrate:rollback        Rollback last migration
   migrate:list            List migration status
   db:import <col> <file>  Import data into a collection
   db:export <col>         Export data from a collection (stdout)
   db:backup               Create a backup snapshot
   db:restore <file>       Restore from a backup file
   status                  Display server health and stats

 Options:
   --port <number>       HTTP server port (default: 8080)
   --db <path>           Database path or data directory
   --config <path>       Path to config file
   --log-level <level>   Log level: debug, info, warn, error
   --timezone <tz>       Server timezone
   --format <fmt>        Format for import/export: csv or json
   --help                Show this help
`;

export function deprecateCommand(oldCmd: string, newCmd: string): void {
  warn(`"${oldCmd}" is deprecated and will be removed in the next release. Use "${newCmd}" instead.`);
}
