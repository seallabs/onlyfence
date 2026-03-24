# Stage 1: Build
FROM node:25-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/ scripts/
RUN npm ci

COPY tsconfig.json CHANGELOG.md ./
COPY src/ src/

RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Stage 2: Runtime
FROM node:25-slim

# Create non-root user
RUN groupadd -r onlyfence && useradd -r -g onlyfence -m onlyfence

WORKDIR /app

# Copy built app and production dependencies
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json package.json

# Copy entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Data directory (mounted volume)
RUN mkdir -p /data && chown onlyfence:onlyfence /data
ENV ONLYFENCE_HOME=/data

# TCP port for daemon
EXPOSE 19876

# Run as non-root
USER onlyfence

ENTRYPOINT ["docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node dist/cli/index.js status || exit 1
