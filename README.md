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

CLI flags override env vars override config file:

```bash
boltstore serve --port 8080 --db ./data --config boltstore.yaml
```

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server port |
| `DATABASE_PATH` | `./data` | Directory for SQLite database files |
| `JWT_SECRET` | — | Secret key for JWT tokens |
| `RATE_LIMIT_PUBLIC` | `60/min` | Rate limit for public endpoints |
| `RATE_LIMIT_AUTH` | `600/min` | Rate limit for authenticated endpoints |
| `SERVER_TIMEZONE` | `UTC` | Server timezone |

## API Tiers

| Prefix | Access | Operations |
|---|---|---|
| `GET /api/health` | Public | Health check |
| `POST /api/auth/*` | Public | Login, register |
| `/api/collections/:collection/records` | Authenticated | CRUD on records |
| `/api/admin/*` | Admin only | Schema changes, indexes, views, raw SQL, transactions |

## Admin Panel

Open `http://localhost:8080/admin` in your browser after starting the server.

During development, Vite HMR automatically refreshes the admin UI as you edit Vue files.

## Development

```bash
bun install
bun run build    # compile TypeScript
bun test         # run tests
bun run dev      # watch mode
```

## Publishing

```bash
npm publish
```

## License

MIT