# Boltstore — Deployment Guide

This guide covers multiple ways to run Boltstore in production.

## Option 1: Standalone Binary (recommended)

The simplest way to run Boltstore. A single self-contained executable with no
runtime dependencies.

### Build the binary

```bash
# Build for Linux (x86_64)
bun run compile

# Build for macOS (Apple Silicon)
bun run compile:macos

# Build for Windows
bun run compile:windows
```

This produces `dist/boltstore` (or `dist/boltstore.exe` on Windows). The binary
is fully self-contained — no need to install Bun, Node, or anything else.

### Run it

```bash
# Initialize a config file
./dist/boltstore init

# Edit the config (optional)
# vim boltstore.json

# Start the server
./dist/boltstore serve

# Run migrations
./dist/boltstore migrate --db myapp

# Check migration status
./dist/boltstore migrations --db myapp

# Rollback the last migration
./dist/boltstore migrate:rollback --db myapp

# Check server health
./dist/boltstore status
```

The binary uses `./data/` as the default data directory. Each app gets its own
SQLite file under `data/{app}/db/{app}.db`.

## Option 2: Docker

### Build and run with docker compose

```bash
docker compose up -d
```

This starts Boltstore on port 8080 with a named volume for persistent storage.
The data is at `/app/data` inside the container (mounted to the `boltstore-data`
volume).

### Build the image manually

```bash
docker build -t boltstore:latest .
docker run -d \
  --name boltstore \
  -p 8080:8080 \
  -v boltstore-data:/app/data \
  --restart unless-stopped \
  boltstore:latest
```

### Customizing via environment variables

```bash
docker run -d \
  -p 9090:9090 \
  -v boltstore-data:/app/data \
  -e PORT=9090 \
  -e LOG_LEVEL=debug \
  -e CORS_ORIGINS="https://app.example.com,https://admin.example.com" \
  boltstore:latest
```

Available environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `DATABASE_PATH` | `./data` | Path to the data directory |
| `LOG_LEVEL` | `info` | debug, info, warn, error |
| `SERVER_TIMEZONE` | `UTC` | IANA timezone identifier |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `CORS_METHODS` | `GET,POST,PATCH,DELETE,OPTIONS` | Comma-separated methods |
| `CORS_HEADERS` | `Content-Type,Authorization` | Comma-separated headers |
| `RATE_LIMIT_PUBLIC` | `100` | Public tier rate limit (req/min) |
| `RATE_LIMIT_AUTH` | `1000` | Authenticated tier rate limit |
| `JWT_SECRET` | unset | Set before Phase 2 enables auth |
| `CONFIG_FILE` | unset | Path to boltstore.json |

## Option 3: Run from source (development)

```bash
git clone https://github.com/boltstore/boltstore.git
cd boltstore
bun install
bun test
bun run dev   # watch mode
bun start     # production mode from source
```

## Reverse proxy / TLS

Boltstore speaks plain HTTP on a single port. Use a reverse proxy for TLS:

### nginx example

```nginx
server {
  listen 443 ssl;
  server_name api.example.com;
  ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Backups

Boltstore stores all data in a single SQLite file per app:

- `data/{app}/db/{app}.db` — the database
- `data/system/db/_boltstore.db` — the registry

To back up, simply copy these files (or the entire `data/` directory). SQLite
supports safe online backups via the `.backup` command in the `sqlite3` CLI:

```bash
sqlite3 data/myapp/db/myapp.db ".backup /backups/myapp-$(date +%Y%m%d).db"
```

## Health check

The server exposes a health endpoint at `GET /api/health` that returns 200 OK
with server status, version, uptime, and the count of registered databases.

```bash
curl http://localhost:8080/api/health
```

The Docker image includes a `HEALTHCHECK` that uses this endpoint for
container orchestration.