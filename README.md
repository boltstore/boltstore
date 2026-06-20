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

Boltstore has two credential systems that serve different purposes:

| Feature | JWT Tokens (User Auth) | API Keys (Machine Auth) |
|---|---|---|
| **Who uses it** | End users (login via email/password or OAuth) | Services, scripts, CLI tools |
| **Where stored** | Application database (`_users`, `_tokens` tables) | System meta database (`_api_keys` table) |
| **Scope** | Scoped to one application database | Global — can access any application database |
| **Lifetime** | Short-lived access token (15 min) + refresh token (7 days) | Permanent until revoked |
| **Rotation** | Auto-refreshed by the SDK | Manual — create a new key, revoke the old one |
| **Rate limiting** | Per-IP, same bucket as unauthenticated | Per-IP (same as other callers) |
| **RLS bypass** | No — RLS policies apply to all JWT-authenticated requests | Yes — API keys bypass RLS (collection scopes are the enforcement) |
| **Admin access** | Only if the user exists in the system database | Only if the key has `operations: ["admin"]` |

### JWT Tokens (User Authentication)

JWT tokens are issued per application database. A user registered in one app database cannot access another. Each login produces two tokens:

- **Access token** — Short-lived (default 15 minutes). Sent as `Authorization: Bearer <token>` with every request. Contains the user ID, email, and a unique token ID (`jti`) that is tracked in the `_tokens` table for revocation.
- **Refresh token** — Longer-lived (default 7 days). Used to obtain a new access token without re-entering credentials. Rotated on each use (the old refresh token is revoked).

Both tokens are tracked in the `_tokens` table of the application database. Expired and revoked tokens are cleaned up every 5 minutes by a background task.

Users can update their own profile (email, password) via `PATCH /api/:database/auth/me`. The `_users` table is a system table and is not directly accessible through the records API.

### API Keys (Machine Authentication)

API keys are system-level credentials stored in the system meta database (`_boltstore.db`). They are created and managed via `/api/admin/:database/api-keys`. All API keys live in the `_api_keys` table in the system database, but they come in two distinct roles:

| Role | Access Scope | Use Case |
|------|-------------|----------|
| **`admin`** | Global — any database, any operation | Infrastructure automation, CI/CD, cross-app admin tasks |
| **`scoped`** | Per-database, per-operation | Service-to-service auth for a specific application |

#### Admin Keys

Admin keys have `role: "admin"` and bypass all permission checks. They can access any database and perform any operation (including schema changes, raw SQL, user management, etc.). These should be few in number and tightly controlled — treat them like root credentials.

- `allowed_databases` is ignored (implicitly all databases)
- `allowed_operations` is ignored (implicitly all operations)
- Passes `requireAdmin()` checks
- Bypasses RLS and collection-level scoping

#### Scoped Keys

Scoped keys have `role: "scoped"` and must explicitly declare which databases (by `dbs_` ID) and which operations they are allowed to perform. They are the recommended choice for service-to-service communication within a specific application.

- **`allowed_databases`** — JSON array of database IDs (`dbs_` prefix) the key can access. Example: `["dbs_a1b2c3d4", "dbs_e5f6g7h8"]`. Use `"*"` to allow all databases. If empty, the key cannot access any database.
- **`allowed_operations`** — JSON array of operations the key can perform. Valid values: `"read"`, `"create"`, `"update"`, `"delete"`. If empty, no operations are allowed.
- **`collections`** (optional) — JSON array of collection names to further restrict access. If omitted, all collections in the allowed databases are accessible. If present, only the listed collections are accessible.
- **No RLS** — Scoped keys bypass Row-Level Security. Access is controlled entirely by the database scopes, operations, and collection allow-lists configured on the key.

#### `_api_keys` Table Schema

```sql
CREATE TABLE IF NOT EXISTS _api_keys (
  id              TEXT PRIMARY KEY,          -- e.g. "apk_a1b2c3d4"
  name            TEXT NOT NULL,             -- Human-readable label
  role            TEXT NOT NULL DEFAULT 'scoped',  -- "admin" | "scoped"
  key_hash        TEXT NOT NULL UNIQUE,      -- bcrypt hash of the raw secret
  prefix          TEXT NOT NULL,             -- First 8 chars (e.g. "blt_aBcD")
  allowed_databases TEXT NOT NULL DEFAULT '[]',  -- JSON array of database IDs (dbs_ prefix)
  allowed_operations TEXT NOT NULL DEFAULT '[]', -- JSON array of operations
  collections     TEXT,                      -- Optional JSON array of collection names
  revoked         INTEGER NOT NULL DEFAULT 0,    -- 0 = active, 1 = revoked
  created_at      TEXT NOT NULL,             -- ISO-8601
  last_used_at    TEXT                        -- ISO-8601, updated on each use
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON _api_keys(prefix);
```

#### Key Properties

- **Prefix-based lookup** — The first 8 characters of the key (`blt_` + 4 random chars) are used as an index prefix for efficient lookup. The full key is hashed with bcrypt before storage.
- **Secret shown once** — The raw key is returned only at creation time. After that, only the prefix is visible via the API.
- **Revocable** — Keys can be revoked at any time via `DELETE /api/admin/:database/api-keys/:id`. Revoked keys are immediately rejected.
- **Permanent** — API keys do not expire. Rotate manually by creating a new key and revoking the old one.
- **No RLS** — API keys bypass Row-Level Security. Access is controlled entirely by the role, database scopes, and operations configured on the key.

#### Creating an API Key

```bash
# Create an admin key (global access)
curl -X POST /api/admin/_system/api-keys \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI/CD Deploy Key",
    "role": "admin"
  }'

# Create a scoped key (read-only on "dbs_a1b2c3d4" database)
curl -X POST /api/admin/_system/api-keys \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyApp Reader",
    "role": "scoped",
    "allowed_databases": ["dbs_a1b2c3d4"],
    "allowed_operations": ["read"]
  }'

# Create a scoped key with collection restrictions
curl -X POST /api/admin/_system/api-keys \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyApp Posts Writer",
    "role": "scoped",
    "allowed_databases": ["dbs_a1b2c3d4"],
    "allowed_operations": ["read", "create", "update"],
    "collections": ["posts"]
  }'
```

#### Using an API Key

```bash
# Via Authorization header (Bearer with blt_ prefix)
curl -H "Authorization: Bearer blt_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789" \
  /api/myapp/collections/posts/records

# Via X-API-Key header
curl -H "X-API-Key: blt_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789" \
  /api/myapp/collections/posts/records
```

> **Important:** API keys are system-level credentials stored in the system meta database (`_boltstore.db`). The `:database` parameter in the admin API key routes is accepted for route consistency but **ignored** — keys are always stored in and verified against the system database. This means a scoped key with `allowed_databases: ["dbs_a1b2c3d4"]` can only access that specific database, but the key itself lives in the system database. Database identifiers must use the `dbs_` prefix (the internal database ID), not the application name.

### Why Tokens Are in Both Databases

The system meta database (`_boltstore.db`) stores:
- `_databases` — registry of all application databases
- `_api_keys` — API keys (global credentials)

Each application database stores its own:
- `_users` — user accounts for that application
- `_tokens` — JWT token records for session tracking and revocation

This separation means:
- A user in app A cannot access app B's data, even with a valid JWT
- API keys are global because they are stored in the system database, not tied to any single app
- Deleting an application database removes all its users and tokens without affecting other apps or API keys

## System Tables

Collections whose names start with `_` (e.g. `_users`, `_tokens`, `_api_keys`) are **system tables** and are only accessible by admin users through the records API. Non-admin users cannot read or write them.

Users update their own profile (email, password) via `PATCH /api/:database/auth/me` — not through the records API. For application-specific user data (avatars, bios, display names), create a separate collection with its own RLS rules.

## Client-side LocalStore (Offline Cache)

The `@boltstore/client` SDK includes an optional offline queryable cache that persists records locally. When configured, it acts as a write-through cache — data is only stored locally *after* the server confirms the operation, so permissions are always enforced server-side first.

**How data flows:**

```
records.create/update/delete ──► SERVER (permission check) ──► localStore (write-through)
client.query()                ──► localStore (cache hit)  ──► SERVER (miss) ──► localStore (cache fill)
client.sync.pull()            ──► SERVER                  ──► localStore (auto-apply)
records.get()                 ──► localStore (cache hit)  ──► SERVER (miss) ──► localStore (cache fill)
```

**Available stores** — all implement the same `LocalStore` interface:

| Store | Environment | Persistence | Dependencies |
|---|---|---|---|
| `MemoryStore` | All | No (in-memory) | None |
| `IndexedDbStore` | Browser | Yes (IndexedDB) | None (browser built-in) |
| `BunSqliteStore` | Bun | Yes (bun:sqlite) | None (Bun built-in) |
| `NodeFileStore` | Node.js | Yes (JSON files) | None (`fs` built-in) |
| `BetterSqlite3Store` | Node.js | Yes (SQLite) | `npm install better-sqlite3` |
| `ReactNativeSqliteStore` | React Native (bare) | Yes (SQLite) | `npm install react-native-sqlite-storage` |
| `ExpoSqliteStore` | React Native (Expo) | Yes (SQLite) | `npx expo install expo-sqlite` |

**Security:** System collections (`_`-prefixed) are never cached — the client skips both reads and writes to the local store for any collection starting with `_`. This is defense-in-depth; the server already rejects non-admin access to system collections.

**Usage example (browser):**

```typescript
import { BoltstoreClient, IndexedDbStore } from "@boltstore/client";

const client = new BoltstoreClient({
  baseUrl: "http://localhost:8080",
  databaseId: "dbs_xxx",
  localStore: new IndexedDbStore(),  // cache all data in IndexedDB
});
```

See the [client README](https://github.com/boltstore/client#localstore-offline-queryable-cache) for the full API.

## Row-Level Security (RLS)

RLS policies are compiled from SQL-like expressions (e.g., `owner_id = $userId`) and cached in memory per pool.

### Caching Latency

RLS uses two in-memory caches that share a **30-second TTL** (`rls.ts:62`, `records/schema-cache.ts:15`):

- **Policy cache** — RLS read/write rules are cached for up to 30s after fetch. After PATCHing a collection's RLS rules via the API, the old rules may still apply for that window.
- **Schema cache** — Column definitions (`PRAGMA table_info`) are cached for 30s. Adding a column via PATCH may not be visible to writes for up to 30s.

The cache is scoped to the `DatabasePool` instance (one per database per process). Calling `invalidateRLSCache()` clears the entry for the affected collection, but only on the same process — multi-process deployments expire independently.

**Recommendation:** After changing RLS or schema, wait 30s or restart the server for immediate consistency.

## Admin Elevation

There is **no HTTP endpoint** for creating admin accounts. This is intentional — admin access controls the entire server (create/delete databases, manage all collections). Requiring a CLI step or pre-deployment seed prevents accidental self-elevation via HTTP and ensures at least one bootstrap admin pathway is always available.

Admin credentials can be created through two channels:

1. **CLI:** `boltstore admin` (or `bun run boltstore admin` from source) — interactive prompt that creates an admin user in the `_system` database (`cli/admin.ts:64`). After creation, log in at `POST /api/_system/auth/login`.
2. **Pre-seeded API keys:** Insert an admin API key directly into `_system._api_keys` with `role: "admin"` during deployment automation.

The `POST /api/_system/auth/register` endpoint explicitly rejects registrations — admin accounts cannot be created through the public registration flow.

## API Tiers

| Prefix | Access | Operations |
|---|---|---|
| `GET /api/health` | Public | Health check |
| `POST /api/auth/*` | Public | Login, register |
| `/api/collections/:collection/records` | Authenticated | CRUD on records (system tables excluded) |
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