# Boltstore

**Boltstore** — A self-hostable **Database-as-a-Service (DBaaS)** built on SQLite + Bun. One process serves many isolated SQLite databases over a REST API, with an admin dashboard for management.

> **What this is:** a database platform. You get SQLite databases over HTTP, multi-database isolation, API keys, an admin dashboard, analytics, import/export, and audit logging. Ship it as a single binary or `bun` process with a data directory.
>
> **What this is not (yet):** a Backend-as-a-Service. Boltstore started with BaaS ambitions (RLS, JWT user auth, realtime, offline sync), but the MVP deliberately scopes those out to ship a solid database platform first. If you need BaaS-style features today, build them in your application layer on top of Boltstore's API — or wait for the plugin system (see "Plugin system (future)" below).

## Features

- **SQLite via HTTP REST API** — Full CRUD on records, table DDL, filtering, sorting, pagination, and a raw SQL endpoint (read-only for non-admin keys).
- **Multi-database support** — One instance serves multiple isolated SQLite databases, each with its own file, config, and API keys.
- **API key authentication** — Per-database API keys for machine access; admin sessions for dashboard access. Keys are SHA-256 hashed at rest.
- **Admin dashboard** — Vue 3 SPA at `/dashboard` for managing databases, tables, records, API keys, analytics, and settings. HMR during development via Vite.
- **Analytics** — Built-in query log and storage snapshots (`_analytics.db`) with admin dashboards for overview, per-database, error, and volume views.
- **Audit logging** — Admin actions (database create/rename/delete, API key create/rotate/revoke, config changes, login/logout) are recorded in `_activity_log` with admin ID and requesting IP.
- **Per-database config** — Each database has its own JSON config (CORS origins, read-only flag, group) editable via the API.
- **Import / export** — Export any database to a `.db` file via `VACUUM INTO`; import a `.db` file to register a new database (with integrity check).
- **Configurable** — YAML / JSON config file, env vars, and CLI flags; merge order is CLI > env > file > defaults.
- **Zero runtime dependencies** — Server core has no third-party npm dependencies; runs on Bun.

### Explicitly NOT in the MVP (and where they'll come from)

Boltstore began as a BaaS design (RLS, JWT user auth, realtime, offline sync, file storage, hooks). The MVP deliberately scopes those out to ship a solid **DBaaS** first. If you need any of the following, they are **application-layer concerns for now** or will arrive **via the plugin system** later — they will not be added to the core.

- **Row-Level Security (RLS)** — Not implemented. Enforce who-can-see-what in your own application code that calls Boltstore. The plugin system (`src/plugin.ts`, `src/events.ts`) is the future extension point where RLS-style enforcement can be layered in without modifying core.
- **JWT / user authentication** — Not implemented. The server has admin sessions (dashboard) and API keys (machine credentials). End-user auth, OAuth, and a `_users` table are BaaS-layer concerns — build them in your app, or wait for an auth plugin.
- **Realtime / WebSocket subscriptions** — Not implemented. No `src/ws/` directory exists. If you need live updates, poll the API or build a realtime layer in front of Boltstore.
- **Offline sync / client-side cache** — Not implemented. The client SDK is HTTP-only.
- **File storage** — Not implemented. Store files in S3 / your filesystem and keep references in Boltstore tables.
- **Hooks / user-defined server functions** — Not implemented; the plugin system is the future home for this.

**The contract:** the core stays a database platform. BaaS features are added by you (application layer) or by plugins — never by bloating the core.

## Quick start

```bash
# Install globally
npm install -g boltstore
boltstore serve --port 8080 --db ./data

# Or run from source
git clone https://github.com/boltstore/boltstore.git
cd boltstore/boltstore
bun install
bun run dev
```

Or with Docker:

```bash
docker run -p 8080:8080 -v ./data:/app/data boltstore/boltstore
```

Then open `http://localhost:8080/dashboard` and create the first admin account.

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

If both `boltstore.yaml` and `boltstore.json` exist, YAML is preferred. Running `boltstore serve` without a config file auto-generates `boltstore.yaml` with defaults.

```bash
# Generate a config file (YAML by default)
boltstore init

# Or generate JSON instead
boltstore init --json

# Override any setting via CLI flags or environment variables
boltstore serve --port 3000 --db ./myapp
PORT=3000 boltstore serve
```

### Config reference

| Config key | Env variable | Default | Description |
|---|---|---|---|
| `port` | `PORT` | `8080` | HTTP server port |
| `databasePath` | `DATABASE_PATH` | `./data` | Directory for SQLite databases and the `_boltstore.db` meta database |
| `adminKey` | `BOLTSTORE_ADMIN_KEY` | — | Bootstrap key for provisioning the first admin account. **One-shot** — see "Admin bootstrap" below. |
| `logLevel` | `LOG_LEVEL` | `info` | Logging: `debug`, `info`, `warn`, `error` |
| `maxBodySize` | `MAX_BODY_SIZE` | `10` (MB) | Max request body size in MB. **Note:** the `/api/databases/import` endpoint is exempt and currently unbounded — see "Known limitations". |
| `requestTimeoutMs` | `REQUEST_TIMEOUT_MS` | `30000` | Request handler timeout in ms (advisory — see Known limitations) |
| `corsOrigins` | `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated). Use an explicit list in production. |
| `corsMethods` | `CORS_METHODS` | `GET,POST,PATCH,DELETE,OPTIONS` | Allowed CORS methods |
| `corsHeaders` | `CORS_HEADERS` | `Content-Type,Authorization` | Allowed CORS headers |
| `trustedProxies` | `TRUSTED_PROXIES` | `[]` | Trusted proxy IPs/CIDRs for honouring `X-Forwarded-For` / `X-Real-IP`. **Note:** currently parsed but not yet enforced — see "Known limitations". |

> **Note on `RATE_LIMIT_*` env vars:** `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_AUTH`, `RATE_LIMIT_ADMIN`, and `RATE_LIMIT_WINDOW_SECONDS` are **reserved for future use and not currently consumed**. Boltstore ships **no built-in rate limiting** in the MVP. Place a reverse proxy, WAF, or Cloudflare in front of the server if you need rate limiting today. See "Known limitations" below.

> **Note on `SERVER_TIMEZONE`:** Removed. The backend **always** stores and returns timestamps in UTC. A timezone selector in the dashboard (if present) is a client-side display preference only and never affects API output.

## Authentication

Boltstore has two credential systems:

| Feature | Admin Sessions | API Keys |
|---|---|---|
| **Who uses it** | Dashboard users (humans) | Services, scripts, CLI tools, your application backend |
| **Where stored** | System meta DB (`_sessions` table) | System meta DB (`_api_keys` table) |
| **Scope** | Global — can administer the whole server | Per-database — bound to one database |
| **Lifetime** | Until logout or the server prunes expired sessions (expiry/rotation is a future enhancement) | Permanent until revoked |
| **Sent as** | `Authorization: Bearer <session-token>` | `Authorization: Bearer <boltstore_...>` |
| **Admin access** | Yes — full admin API + dashboard | No — data API only (records, tables, raw SQL `SELECT`). DDL/DML via raw SQL requires an admin key. |

### Admin accounts & bootstrap

There is **no CLI admin command**. Admin accounts are created via the dashboard's first-run setup flow or the `POST /api/admin/setup` endpoint.

**Bootstrap flow:**
1. Start the server with no existing admins. The dashboard will show the "Create Admin Account" screen.
2. Submit an email + password (min 8 chars). The first admin is created with no auth required.
3. Subsequent admin creation requires either an existing admin session **or** the bootstrap key (`BOLTSTORE_ADMIN_KEY`).

**Bootstrap key semantics (important):**
- The bootstrap key is intended to provision **exactly one** admin account and then be consumed. After the first admin is created via bootstrap, a `bootstrap_consumed` meta flag is set and the key cannot be used again.
- Treat it as a one-shot provisioning secret. Set `BOLTSTORE_ADMIN_KEY` in your env / config only during initial deployment, then unset it.
- Comparison is constant-time (`timingSafeEqual`).
- **Login / setup throttling:** Admin login and setup endpoints are throttled per-IP (5 attempts per 15-minute window) to prevent brute-force attacks. Local/loopback requests are not throttled.

### API keys

API keys are system-level credentials stored in the `_api_keys` table in the meta database. Each key is bound to a single database.

- **Format:** `boltstore_` + 32 random alphanumeric characters.
- **At rest:** SHA-256 hashed (never stored plaintext). The raw key is returned **only once** at creation time.
- **Per-database:** A key for database `foo` cannot access database `bar`. Admin keys / sessions can access any database.
- **Operations:** A non-admin API key can read/write records, manage tables on its database, and run `SELECT` raw SQL. DDL/DML via the raw `/query` endpoint requires an admin key (see "Raw SQL" below).
- **Management:** Created, rotated, and revoked via the admin API (`/api/databases/:name/keys`) or the dashboard.

```bash
# Create an API key (requires admin session)
curl -X POST http://localhost:8080/api/databases/myapp/keys \
  -H "Authorization: Bearer <admin-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"label": "My App Backend"}'
# → { "data": { "id": "apk_...", "label": "My App Backend", "key": "boltstore_..." } }

# Use the key
curl -H "Authorization: Bearer boltstore_..." \
  http://localhost:8080/api/databases/myapp/tables
```

### System tables

Tables whose names start with `_` (e.g. `_boltstore` internal tables) are system tables. The records API refuses to operate on them; only admin routes touch system tables.

## API tiers

| Prefix / route | Access | Operations |
|---|---|---|
| `GET /api/health` | Public | Health check (status, version, database count) |
| `POST /api/admin/status` | Public | Whether any admins exist (used by dashboard setup flow) |
| `POST /api/admin/setup` | Bootstrap key (after first admin) / open (before first admin) | Create admin account |
| `POST /api/admin/login` | Public | Admin login (returns session token) |
| `GET /api/admin/me` | Admin session | Current admin info |
| `POST /api/admin/logout` | Admin session | End session |
| `/api/databases` (GET, POST) | Admin | List / create databases |
| `/api/databases/:name` (GET, PATCH, DELETE) | Admin | Database detail / rename / delete |
| `/api/databases/:name/config` (GET, PATCH) | Admin | Per-database config |
| `/api/databases/:name/keys` (GET, POST) | Admin | List / create API keys |
| `/api/databases/:name/keys/:id/rotate` (POST) | Admin | Rotate a key |
| `/api/databases/:name/keys/:id` (DELETE) | Admin | Revoke a key |
| `/api/databases/:name/export` (POST) | Admin | Export database file |
| `/api/databases/import` (POST) | Admin | Import a `.db` file |
| `/api/settings` (GET, PATCH) | Admin | Global settings |
| `/api/activity` (GET) | Admin | Audit log |
| `/api/analytics/*` (GET) | Admin | Analytics dashboards |
| `/api/databases/:db/tables` (GET, POST) | API key or admin | List / create tables |
| `/api/databases/:db/tables/:table` (GET, PATCH, DELETE) | API key or admin | Table schema / alter / drop |
| `/api/databases/:db/tables/:table/records` (GET, POST) | API key or admin | List / create records |
| `/api/databases/:db/tables/:table/records/:id` (GET, PATCH, DELETE) | API key or admin | Record CRUD |
| `/api/databases/:db/query` (POST) | API key or admin | Raw SQL — **`SELECT` only for non-admin keys**; DDL/DML requires admin |

### Raw SQL endpoint

`POST /api/databases/:db/query` accepts `{ sql: string, params?: unknown[] }` and runs the statement with parameterised bindings.

**Policy (MVP):**
- **Non-admin API keys may only execute `SELECT` statements.** Any `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `REPLACE`, `VACUUM`, `ATTACH`, `DETACH`, `PRAGMA`, `REINDEX`, or `ANALYZE` statement is rejected with `403 FORBIDDEN` / `WRITE_REQUIRES_ADMIN` for non-admin keys.
- **Admin keys / sessions may execute any statement.**
- If the database is in read-only mode (per-database config), writes are rejected for everyone.

> **Note:** The current implementation does not yet enforce the SELECT-only policy for non-admin keys — see `audits.md` M2.4. Until that lands, assume any API key can run any SQL via `/query` and only hand API keys to trusted services.

## Timestamps & timezones

**The backend is UTC-only.** All `created_at`, `updated_at`, activity log, analytics, and audit timestamps are stored and returned as UTC ISO-8601 strings via SQLite's `datetime('now')`. This is a hard invariant — do not attempt to shift the server timezone.

The dashboard may offer a timezone selector for **display only** — converting UTC timestamps to the viewer's local time in the browser. This conversion never affects API output.

## Audit logging

Admin actions are recorded in the `_activity_log` table with the admin ID, action, target database, and the requesting IP. Logged actions include: `admin.create`, `admin.login`, `admin.logout`, `database.create`, `database.rename`, `database.delete`, `database.import`, `database.export`, `database.config.update`, `api_key.create`, `api_key.rotate`, `api_key.revoke`, `table.create`, `table.rename`, `table.delete`, `settings.update`.

> **Retention & privacy note:** Activity logs store the requesting IP in plaintext for provenance. Boltstore does not auto-redact or expire the log. If your jurisdiction requires IP redaction or retention limits (e.g. GDPR), apply your own retention/hashing policy by periodically pruning `_activity_log` rows — this is an operator responsibility, not a Boltstore feature.

## Admin panel

The Vue 3 dashboard is served at `/dashboard`. In development, run the Vite dev server for HMR:

```bash
# Terminal 1: backend
cd boltstore && bun run dev

# Terminal 2: admin dashboard with HMR
cd boltstore/admin && npm run dev
```

Open `http://localhost:5173/dashboard` for HMR, or `http://localhost:8080/dashboard` for the server-proxied build (no HMR). The server auto-detects the Vite dev server on port 5173.

To build the dashboard for production:

```bash
cd boltstore/admin && npm run build
# Output lands in boltstore/admin/dist/ and is served by the server at /dashboard
```

## Development

```bash
git clone https://github.com/boltstore/boltstore.git
cd boltstore/boltstore
bun install
```

### Run the server from source

```bash
bun run dev          # watch mode, auto-restarts
# or
bun run boltstore serve
```

Without a command argument, `bun run boltstore` starts the server on port 8080.

### CLI commands

```bash
# Start the server (auto-generates boltstore.yaml if missing)
bun run boltstore serve

# Generate a config file (YAML by default)
bun run boltstore init

# Or generate JSON
bun run boltstore init --json

# Show help
bun run boltstore --help
```

> The `admin`, `migrate`, `db:backup`, `db:restore`, `applications`, and `status` CLI commands documented in older versions of this README **do not exist** in the MVP. Admin creation is via the dashboard setup flow, not a CLI command.

### Build and run from dist

```bash
bun run bolt:build
cd boltstore && bun run start
```

### Run tests

```bash
bun run bolt:test
# or
cd boltstore && bun test
```

### Compile a standalone binary

```bash
# macOS Apple Silicon
bun run bolt:compile

# Linux x64
cd boltstore && bun run compile

# Windows x64
cd boltstore && bun run compile:windows
```

## Known limitations (MVP)

These are tracked in `audits.md` with severity ratings.

- **No built-in rate limiting for the data API.** Admin login/setup has a per-IP throttle (5 attempts per 15 min), but the data API (records, tables, query) is intentionally unthrottled — in the Turso-like model, developers hold one API key for their backend server. Place a reverse proxy / WAF / Cloudflare in front of the server if you need data-API rate limiting.
- **`requestTimeoutMs` is advisory** — the timer fires and returns 408 to the client, but the underlying SQLite query continues to run. (`audits.md` M6.4)
- **The YAML config parser is minimal** — flat key/value pairs and simple arrays only. No nested maps, anchors, or flow style. (`audits.md` L13.8)

See `audits.md` for the complete list and the fix plan for each.

## Plugin system (future)

Boltstore includes a minimal plugin interface (`src/plugin.ts`) and event emitter (`src/events.ts`) as **reserved infrastructure**. No plugins are loaded yet and no events are emitted. Once plugin loading is implemented (post-MVP), plugins will be able to subscribe to `query`, `database:create`, `table:create`, and other events to add features like RLS-style enforcement, custom validation, or analytics enrichment without modifying core.

## Publishing

```bash
npm publish
```

## License

MIT