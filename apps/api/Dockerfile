# syntax=docker/dockerfile:1.7

# ---------- builder ----------
# Compiles @carrier-sales/shared and @carrier-sales/api with the full dev
# toolchain (tsc + pnpm). We deliberately do not build dashboard/convex
# here -- they're separate deploy units.
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app

# Workspace skeleton first so the install layer is cached independently
# of source edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/convex/package.json packages/convex/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# Source after install so edits don't bust the deps cache.
COPY packages/shared/ packages/shared/
COPY packages/convex/ packages/convex/
COPY apps/api/ apps/api/

RUN pnpm --filter @carrier-sales/shared build && \
    pnpm --filter @carrier-sales/api build

# `pnpm deploy` materializes a self-contained node_modules for a single
# workspace package, stripping dev deps and flattening workspace links
# into a portable tree we can copy into the runtime image.
# --legacy keeps pre-v10 deploy semantics (no inject-workspace-packages
# required); without it pnpm v10 aborts with ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE.
RUN pnpm --filter @carrier-sales/api deploy --prod --legacy /prod/api

# ---------- runner ----------
FROM node:22-alpine AS runner

# Dokploy injects DOKPLOY_COMMIT_SHA at build time. Wiring it in via an
# explicit --build-arg avoids the "literal ${DOKPLOY_COMMIT_SHA}" trap:
# runtime env files (including Dokploy's Env tab) don't expand `${VAR}`
# syntax, so SERVICE_VERSION="${DOKPLOY_COMMIT_SHA}" persisted as a literal
# string on every span/log. Baking it as an image env makes it observable
# even when the runtime env forgets to set it, and Dokploy's Env tab can
# still override SERVICE_VERSION for ad-hoc deploys.
ARG GIT_COMMIT_SHA=unknown

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    SERVICE_VERSION=${GIT_COMMIT_SHA}

RUN apk add --no-cache wget tini && \
    addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -h /home/appuser appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /prod/api/package.json ./package.json
COPY --from=builder --chown=appuser:appgroup /prod/api/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /prod/api/dist ./dist

USER appuser

EXPOSE 3111

# Aligned with the Fastify health route registered in src/routes/internal
# and the PORT env (default 3111 in src/config.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3111/api/v1/health || exit 1

# tini reaps zombies so BullMQ child processes and OTel workers shut
# down cleanly on SIGTERM from Dokploy.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]

LABEL org.opencontainers.image.title="Carrier Sales API" \
      org.opencontainers.image.description="Fastify Bridge API for HappyRobot carrier sales automation" \
      org.opencontainers.image.revision="${GIT_COMMIT_SHA}"
