---
name: docker-dokploy
description: Author and modify Dockerfiles, docker-compose.yml, and Dokploy deploy config for the carrier-sales monorepo with correct multi-stage builds, pnpm workspace wiring, non-root runtime, healthchecks, and build-arg vs runtime-env discipline. Use when editing apps/*/Dockerfile, docker-compose*.yml, infra/**, adding a new deployable app, or troubleshooting a Dokploy build/deploy.
---

# Docker + Dokploy

Two images ship: `apps/api/Dockerfile` (Motia bundle running on Bun)
and `apps/dashboard/Dockerfile` (Vite static bundle served by nginx).
Both are built by Dokploy from the monorepo root on push to `main`.
This skill captures the conventions.

Quick reference: `.cursor/rules/docker-dokploy.mdc`. Runbook:
[docs/dokploy-setup.md](../../../docs/dokploy-setup.md).

## The two Dockerfiles at a glance

| | API | Dashboard |
| --- | --- | --- |
| Builder | `node:22-alpine` + pnpm | `node:22-alpine` + pnpm |
| Runner | `oven/bun:1.1-slim` | `nginx:1.27-alpine` |
| Entrypoint | `iii --config config.yaml` | `nginx -g 'daemon off;'` (image default) |
| Non-root | yes (`appuser:1001`) | **no** (gap -- fix when touching) |
| Healthcheck | `GET /api/v1/health` | `GET /` |
| Ports | 3111 (http), 3112 (stream) | 80 |
| Build-time args | -- | `VITE_CONVEX_URL` |

## Multi-stage template

Copy this shape; don't invent new variants.

```dockerfile
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Layer 1: manifests only -- cached while dependencies don't change.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/convex/package.json packages/convex/
COPY apps/<app>/package.json apps/<app>/

# Layer 2: install.
RUN pnpm install --frozen-lockfile

# Layer 3: source. Changes often; install cache above is preserved.
COPY packages/shared/ packages/shared/
COPY packages/convex/ packages/convex/
COPY apps/<app>/ apps/<app>/

# Layer 4: build. Shared FIRST -- the app depends on its dist/.
RUN pnpm --filter @carrier-sales/shared build && \
    pnpm --filter @carrier-sales/<app> build

# --- runner ---
FROM <runtime-base> AS runner
# ... (see below)
```

The layer order is not stylistic. Reordering destroys cache and
turns a source-only change into a full `pnpm install` run.

### Why shared-build first

`@carrier-sales/api` and `@carrier-sales/dashboard` import the shared
package's `dist/` (set in its `package.json`'s `exports`). Running
the app build before the shared build either fails or silently uses
stale types from a prior build. Keep the `&&` chain -- no parallel
Turbo inside Docker; the layering already makes it serial for a reason.

## `pnpm install --frozen-lockfile`

Always. `--no-frozen-lockfile` in CI or Docker is a PR-blocker --
it turns `pnpm-lock.yaml` drift into a silent dependency version
change, invalidating the local/CI/production contract.

Locally: if you legitimately changed deps, run `pnpm install` once
locally (which updates the lockfile), commit both `package.json` and
`pnpm-lock.yaml`, then the Docker build resumes working.

## Runner stages

### API runner (`oven/bun:1.1-slim`)

Why Bun: Motia's production bundle is shipped as a single
`index-production.js` and Bun's start time beats Node for tiny scripts.
The `iii` CLI (Motia's runtime) is installed in a separate stage:

```dockerfile
FROM debian:bookworm-slim AS iii-installer
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://install.iii.dev/iii/main/install.sh | VERSION=0.10.0 sh
```

`VERSION=0.10.0` is **pinned**. Do not bump drive-by. A version bump
is a standalone commit with a note on what's new.

Then:

```dockerfile
FROM oven/bun:1.1-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --create-home appuser

WORKDIR /app
COPY --from=iii-installer /root/.local/bin/iii /usr/local/bin/iii
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist/index-production.js ./dist/
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist/index-production.js.map ./dist/
COPY --from=builder --chown=appuser:appgroup /app/apps/api/config-production.yaml ./config.yaml
COPY --from=builder --chown=appuser:appgroup /app/apps/api/package.json ./package.json
USER appuser
```

`--chown=appuser:appgroup` on every `COPY --from=builder`. Without it
the files are `root:root` and bun runs as `appuser` -- writes to
`./dist/` (e.g. sourcemap regeneration) fail at runtime.

### Dashboard runner (`nginx:1.27-alpine`)

```dockerfile
FROM nginx:1.27-alpine AS runner
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
```

Current gap: no non-root user, no `--chown`. If you edit this
Dockerfile, add:

```dockerfile
RUN addgroup -S appgroup && adduser -S -G appgroup appuser
COPY --from=builder --chown=appuser:appgroup /app/apps/dashboard/dist /usr/share/nginx/html
# nginx-unprivileged is the cleaner fix, but not a drive-by swap
```

Until nginx runs unprivileged, at least chown the web root.

## Healthchecks

Every image has one. The two rules:

1. Use `wget --spider` (not `curl`). Neither runtime base ships curl;
   adding it is one apt package and one layer you don't need.
2. Path is the app's real health endpoint. For the API: `GET
   /api/v1/health` -- explicitly bypassed by `apiKeyAuth` (see
   `.cursor/rules/api-security.mdc`).

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3111/api/v1/health || exit 1
```

Dokploy uses container health to decide rollout; a missing or wrong
healthcheck causes silent bad deploys.

## Build args vs runtime env

| | Build arg | Runtime env |
| --- | --- | --- |
| Baked into the image? | Yes | No |
| Use for | Public config (Vite `VITE_*`) | Everything else |
| Secrets? | **Never** | Yes -- that's the point |
| Changing requires | Rebuild | Restart |

In `docker-compose.yml`:

```yaml
dashboard:
  build:
    args:
      VITE_CONVEX_URL: ${VITE_CONVEX_URL:-https://placeholder.convex.cloud}
api:
  env_file: .env
```

Never, under any circumstances, move a secret into `build.args` /
`ARG`. It ends up in the image layers and in the build cache.

## Labels

Every image carries OCI labels so Dokploy's UI renders something
useful:

```dockerfile
LABEL org.opencontainers.image.title="Carrier Sales API" \
      org.opencontainers.image.description="Motia-powered Bridge API for HappyRobot carrier sales automation"
```

When adding a third image (worker? docs?) follow the same pattern.

## docker-compose

Local dev mirrors the deploy shape. Keep it minimal:

```yaml
services:
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    ports: ["3111:3111", "3112:3112"]
    env_file: .env
    restart: unless-stopped
    healthcheck: { test: ["CMD", "wget", "--spider", "-q", "http://localhost:3111/api/v1/health"], ... }
  dashboard:
    build:
      context: .
      dockerfile: apps/dashboard/Dockerfile
      args:
        VITE_CONVEX_URL: ${VITE_CONVEX_URL:-https://placeholder.convex.cloud}
    ports: ["3000:80"]
```

Do not add `depends_on: api` to the dashboard -- they're independent
deployables in prod, and compose `depends_on` doesn't wait for health
by default.

## Dokploy wiring (the parts that catch people)

- **Build Context = `.`**, Dockerfile path = `apps/<app>/Dockerfile`.
  The workspace lockfile is required, so the repo root is the build
  context for both images.
- **`VITE_CONVEX_URL` is a Build Arg**, not a runtime env. Changing
  it requires Redeploy, not Restart (it's inlined into the bundle).
- **Attach `signoz-net`** to the API application after creating it;
  OTLP export (`http://signoz-otel-collector:4317`) is on an internal
  Docker network.
- **`REDIS_URL=redis://redis:6379`** is required by Motia iii; the
  Redis service is a Dokploy template deployed in the same project.

See `docs/dokploy-setup.md` for the full walkthrough.

## Common failure modes

| Symptom | Likely cause |
| --- | --- |
| `pnpm install` takes 5 minutes on every source change | Source `COPY` is above the manifest `COPY` / `pnpm install` layer -- reorder per the template. |
| `Module not found: @carrier-sales/shared` in the app build | Shared build is missing or runs after the app build -- chain with `&&` and put shared first. |
| `Error: Cannot find module 'iii'` on boot | `iii-installer` stage was edited / skipped; check `COPY --from=iii-installer`. |
| `EACCES: permission denied` writing sourcemap | `--chown=appuser:appgroup` missing on a `COPY --from=builder`. |
| Healthcheck fails forever in Dokploy | Path wrong, or `apiKeyAuth` isn't bypassing the health path anymore. |
| `VITE_CONVEX_URL` is `undefined` in the bundle | It was added as a runtime env, not a Build Arg -- Vite only reads build-time. |

## Checklist

When editing an image:

- [ ] Base images unchanged (`node:22-alpine`, `oven/bun:1.1-slim`,
      `nginx:1.27-alpine`) or the bump has its own commit
- [ ] Manifest `COPY` before source `COPY`; `pnpm install` between them
- [ ] `pnpm install --frozen-lockfile` (never `--no-frozen-lockfile`)
- [ ] Shared build before the app build
- [ ] Non-root user + `--chown` on every `COPY --from=builder`
- [ ] `HEALTHCHECK` using `wget --spider`
- [ ] No secrets in `ARG` / `LABEL` / build log
- [ ] `LABEL org.opencontainers.image.title` + `description` present
- [ ] `iii` version pin (API only) intentional
