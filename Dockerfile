# Multi-stage Dockerfile for Boltstore
# Stage 1: Build the TypeScript project
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy package.json and install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# Stage 2: Production runtime with multi-arch support
FROM oven/bun:1.3 AS runtime

WORKDIR /app

# Copy package.json and install only production dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy built code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY tsconfig.json ./

# Create data directory for SQLite databases
RUN mkdir -p /app/data

# Expose port 8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Default to running the server
ENV PORT=8080
ENV DATABASE_PATH=/app/data
ENV LOG_LEVEL=info
ENV SERVER_TIMEZONE=UTC

CMD ["bun", "run", "dist/index.js"]