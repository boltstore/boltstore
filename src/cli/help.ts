export const HELP = `
 ⚡ boltstore — Managed SQLite databases with HTTP API

 Usage: boltstore <command> [options]

 Commands:
   serve                   Start the HTTP server
   init [--json]           Generate a config file (boltstore.yaml by default)
   help                    Show this help

 Options:
   --port <number>       HTTP server port (default: 8080)
   --db <path>           Data directory path
   --config <path>       Path to config file
   --log-level <level>   Log level: debug, info, warn, error
   --timezone <tz>       Server timezone
   --max-body-size <n>   Max request body size in bytes
   --request-timeout <n> Request timeout in milliseconds
   --trusted-proxies     Comma-separated list of trusted proxy IPs
   --help                Show this help
`;
