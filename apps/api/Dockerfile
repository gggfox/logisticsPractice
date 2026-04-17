FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/convex/package.json packages/convex/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/convex/ packages/convex/
COPY apps/api/ apps/api/

# Build the shared package, then produce Motia's production bundle
# (`apps/api/dist/index-production.js{,.map}`).
RUN pnpm --filter @carrier-sales/shared build && \
    pnpm --filter @carrier-sales/api exec motia build

FROM debian:bookworm-slim AS iii-installer

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://install.iii.dev/iii/main/install.sh | VERSION=0.10.0 sh

FROM oven/bun:1.1-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --create-home appuser

WORKDIR /app

COPY --from=iii-installer /root/.local/bin/iii /usr/local/bin/iii
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist/index-production.js ./dist/
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist/index-production.js.map ./dist/
# Bump to bust Docker layer cache when we only change config-production.yaml.
ARG CONFIG_REV=2026-04-17-01
RUN echo "config rev ${CONFIG_REV}" > /tmp/.config-rev
COPY --from=builder --chown=appuser:appgroup /app/apps/api/config-production.yaml ./config.yaml
COPY --from=builder --chown=appuser:appgroup /app/apps/api/package.json ./package.json

USER appuser

# 3111 = iii-http, 3112 = iii-stream
EXPOSE 3111
EXPOSE 3112

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3111/api/v1/health || exit 1

CMD ["iii", "--config", "config.yaml"]

LABEL org.opencontainers.image.title="Carrier Sales API" \
      org.opencontainers.image.description="Motia-powered Bridge API for HappyRobot carrier sales automation"
