# Boltstore

**Boltstore** — A lightweight, self-hostable backend-as-a-service on SQLite + bun.js.

Built for mobile apps that need offline sync, realtime updates, and managed authentication — without the complexity of managing a full cloud backend.

## Features

- **SQLite via HTTP REST API** — Full CRUD, filtering, sorting, pagination, aggregation, FTS5, JSON extraction, and raw SQL
- **Multi-database support** — One instance serves multiple apps, each with isolated SQLite databases
- **Realtime WebSocket** — Live subscriptions on collection and record changes
- **Offline sync** — Client-side sync with conflict resolution (last-write-wins, custom merge)
- **Authentication** — Email/password, JWT tokens, OAuth (future), Row-Level Security
- **File storage** — Local filesystem and S3-compatible providers
- **Hooks & extensions** — User-defined JavaScript functions for validation, auth, and business logic
- **Admin panel** — Vue 3 SPA served at `/admin` with HMR during development
- **Secure by design** — Route tiers (Public → Authenticated → Admin), parameterized queries, audit logging

## Quick start

```bash
npm install -g boltstore
boltstore serve --port 8080 --db ./data
```

Or with Docker:

```bash
docker run -p 8080:8080 -v ./data:/data boltstore/boltstore
```

## Configuration

Boltstore merges settings from four sources. Each source overrides the one below it:

```
  CLI flags          (highest priority)
      ↓
  Environment variables
      ↓
  Config file        (boltstore.yaml or boltstore.json, auto-detected)
      ↓
  Defaults           (lowest priority)
```

If both `boltstore.yaml` and `boltstore.json` exist, YAML is used first.

```bash
# Generate a config file (YAML by default)
boltstore init

# Or generate JSON instead
boltstore init --json

# boltstore.yaml / boltstore.json is auto-detected — no --config needed
boltstore serve

# Override any setting via CLI flags or environment variables
boltstore serve --port 3000 --db ./myapp
PORT=3000 boltstore serve
```

| Config key | Env variable | Default | Description |
|---|---|---|---|
| `port` | `PORT` | `8080` | HTTP server port |
| `databasePath` | `DATABASE_PATH` | `./data` | Directory for SQLite databases |
| `jwtSecret` | `JWT_SECRET` | — | Secret key for JWT tokens |
| `rateLimitPublic` | `RATE_LIMIT_PUBLIC` | `100` | Rate limit for public endpoints (req/min) |
| `rateLimitAuth` | `RATE_LIMIT_AUTH` | `1000` | Rate limit for authenticated endpoints (req/min) |
| `rateLimitAdmin` | `RATE_LIMIT_ADMIN` | `500` | Rate limit for admin endpoints (req/min) |
| `rateLimitWindowSeconds` | `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate limit window in seconds |
| `serverTimezone` | `SERVER_TIMEZONE` | `UTC` | Server timezone |
| `logLevel` | `LOG_LEVEL` | `info` | Logging: debug, info, warn, error |
| `maxBodySize` | `MAX_BODY_SIZE` | `1048576` | Max request body in bytes |
| `requestTimeoutMs` | `REQUEST_TIMEOUT_MS` | `30000` | Request handler timeout in ms |
| `maxBatchSize` | `MAX_BATCH_SIZE` | `1000` | Max operations per batch/transaction |
| `corsOrigins` | `CORS_ORIGINS` | `[]` | Allowed CORS origins (comma-separated) |
| `corsMethods` | `CORS_METHODS` | `GET,POST,PATCH,DELETE,OPTIONS` | Allowed CORS methods |
| `corsHeaders` | `CORS_HEADERS` | `Content-Type,Authorization` | Allowed CORS headers |
| `trustedProxies` | `TRUSTED_PROXIES` | `[]` | Trusted proxy IPs/CIDRs |

## Authentication

Boltstore supports two authentication methods:

- **JWT tokens** — Issued via `POST /api/:database/auth/login`. Scoped to a single application database. Users created in one app database cannot access another.
- **API keys** — System-level credentials stored in the meta database (`_boltstore.db`). Created and managed via `/api/admin/:database/api-keys`. API keys are **global credentials** — an admin API key can manage any application database. They are not scoped to a single app database.

> **Important:** API keys are system-level credentials. An API key created inside an application database (via the SDK or direct DB access) is not recognized by the system and will be rejected with 401. Always create API keys through the admin API routes, which authenticate against the system database.

## API Tiers

| Prefix | Access | Operations |
|---|---|---|
| `GET /api/health` | Public | Health check |
| `POST /api/auth/*` | Public | Login, register |
| `/api/collections/:collection/records` | Authenticated | CRUD on records |
| `/api/admin/*` | Admin only | Schema changes, indexes, views, raw SQL, transactions, API key management |

## Admin Panel

> **Note:** The admin panel is not yet available. The `/admin` route currently returns a 404.

## Development

```bash
git clone https://github.com/boltstore/boltstore.git
cd boltstore
bun install
```

### Run the server from source

```bash
JWT_SECRET="dev-secret-thats-at-least-32-bytes!!" bun run boltstore
```

> **Note:** `bolt` and `boltstore` are aliases — both point to `src/bin.ts`. Use whichever you prefer.

Without a command argument, the server starts on port 8080. With a command argument, it dispatches to the corresponding CLI command.

### CLI commands

```bash
# Start the server (auto-generates boltstore.yaml if missing)
bun run boltstore serve

# Generate a config file (YAML by default)
bun run boltstore init

# Or generate JSON
bun run boltstore init --json

# Create an admin account (CLI-only, interactive prompt)
bun run boltstore admin

# List applications with their database IDs and paths
bun run boltstore applications

# Create a new application
bun run boltstore applications --create myapp

# Rename an application
bun run boltstore applications --rename myapp "new-name"

# Delete an application (irreversible — requires confirmation)
bun run boltstore applications --delete myapp

# Run pending migrations
bun run boltstore migrate --db myapp --dir ./migrations

# Rollback last migration
bun run boltstore migrate:rollback --db myapp

# List migration status
bun run boltstore migrate:list --db myapp

# Import data
bun run boltstore db:import todos mydata.csv --db myapp --format csv

# Export data (prints to stdout)
bun run boltstore db:export todos --db myapp --format json

# Create a backup
bun run boltstore db:backup --db myapp --label "pre-deploy"

# Restore from a backup file
bun run boltstore db:restore ./data/backups/myapp-20260101.db --db myapp

# Check server status
bun run boltstore status

# Show help
bun run boltstore --help
```

### Build and run from dist

```bash
bun run bolt:build
JWT_SECRET="dev-secret-thats-at-least-32-bytes!!" cd boltstore && bun run start
```

### Run tests

```bash
bun run bolt:test
```

### Watch mode

```bash
cd boltstore && bun run dev
```

### Compile a binary

```bash
# macOS Apple Silicon
bun run bolt:compile

# Linux x64
cd boltstore && bun run compile

# Windows x64
cd boltstore && bun run compile:windows
```

## Publishing

```bash
npm publish
```

## License

MIT