# Deploying to Dokploy on a Hostinger VPS

This guide walks through deploying the **API** and **Dashboard** to a [Hostinger](https://www.hostinger.com/) VPS running [Dokploy](https://dokploy.com/). It assumes Dokploy is already installed and reachable at `https://<your-dokploy-host>`.

If you need to install Dokploy from scratch, follow the official one-liner on a fresh Ubuntu 22.04+ VPS:

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Then open `http://<vps-ip>:3000` and complete the first-run wizard to create the admin account.

---

## 1. Prerequisites

- A Hostinger VPS with a public IP and at least 2 vCPU / 4 GB RAM.
- Dokploy installed and logged in.
- A domain (or two subdomains) pointed to the VPS:
  - `api.<yourdomain>` -> VPS IP (A record)
  - `dashboard.<yourdomain>` -> VPS IP (A record)
- A Convex project with its deployment URL (`https://<project>.convex.cloud`).
- A GitHub integration configured in Dokploy (`Settings -> Git Providers -> GitHub App`), authorized against this repository.

## 2. Create a Project

In the Dokploy UI:

1. Go to **Projects -> Create Project**.
2. Name it `carrier-sales` (or similar). Both applications below will live inside this project.

## 3. Create the `api` Application

1. Inside the project, click **Create Application**.
2. **Name**: `api`
3. **Source**:
   - Provider: GitHub
   - Repository: this repo
   - Branch: `main`
   - Auto Deploy: **enabled** (so Dokploy rebuilds on every push to `main`)
4. **Build**:
   - Build Type: **Dockerfile**
   - Dockerfile Path: `apps/api/Dockerfile`
   - Build Context: `.` (monorepo root)
5. **Network**:
   - Container Port: `3111` (iii-http)
   - Additional Port: `3112` (iii-stream, internal only — do not attach a domain)
   - Attach the `signoz-net` Docker network so the API can push OTLP to the
     SigNoz collector (see [section 9](#9-observability-stack-signoz)).
6. **Environment Variables** (paste into the Env tab):
   ```env
   HTTP_PORT=3111
   STREAM_PORT=3112
   DASHBOARD_ORIGIN=https://dashboard.<yourdomain>
   BRIDGE_API_KEY=...
   ADMIN_API_KEY=...
   FMCSA_WEB_KEY=...
   CONVEX_URL=https://<project>.convex.cloud
   WEBHOOK_SECRET=...
   HAPPYROBOT_API_KEY=...
   HAPPYROBOT_BASE_URL=https://api.happyrobot.ai

   # Required by the iii production runtime (state / stream / pubsub adapters)
   REDIS_URL=redis://redis:6379

   # Observability (see section 9)
   OTEL_ENABLED=true
   OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-otel-collector:4317
   OTEL_SERVICE_NAME=carrier-sales-api
   SERVICE_VERSION=${DOKPLOY_COMMIT_SHA}
   SERVICE_NAMESPACE=production
   DEPLOYMENT_REGION=hostinger-eu
   ```
7. **Domains**:
   - Host: `api.<yourdomain>`
   - Path: `/`
   - Container Port: `3111`
   - HTTPS: **enabled** (Let's Encrypt)
8. Click **Deploy**. Watch the build log until the container is healthy (`/api/v1/health` must return 200).

## 4. Create the `dashboard` Application

1. From the same project, click **Create Application**.
2. **Name**: `dashboard`
3. **Source**: same repo, branch `main`, Auto Deploy **enabled**.
4. **Build**:
   - Build Type: **Dockerfile**
   - Dockerfile Path: `apps/dashboard/Dockerfile`
   - Build Context: `.`
5. **Build Args** (baked into the Vite bundle at build time):
   ```env
   VITE_CONVEX_URL=https://<project>.convex.cloud
   ```
6. **Network**:
   - Container Port: `80`
7. **Domains**:
   - Host: `dashboard.<yourdomain>`
   - Path: `/`
   - Container Port: `80`
   - HTTPS: **enabled**
8. Click **Deploy**.

> **Note**: `VITE_CONVEX_URL` must be set as a **Build Arg**, not a runtime Env, because Vite inlines `import.meta.env.*` at build time. Changing this value requires a rebuild (click **Redeploy**).

## 5. Verify

After both builds succeed:

```bash
curl -H "x-api-key: $BRIDGE_API_KEY" https://api.<yourdomain>/api/v1/health
# -> {"status":"ok"}
open https://dashboard.<yourdomain>
```

## 6. CI/CD flow

- GitHub push to `main` -> Dokploy GitHub webhook -> both apps rebuild and redeploy in parallel.
- GitHub Actions also runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (lint, typecheck, unit, e2e, build) on every push and PR.
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) waits for Dokploy, then performs a post-deploy health check against `vars.API_URL`. Configure:
  - Repo **variable** `API_URL` = `https://api.<yourdomain>`
  - Repo **secret** `BRIDGE_API_KEY` = the same value used in Dokploy

## 7. Secrets & rotations

All runtime secrets live in Dokploy's per-application Env tab. To rotate:

1. Update the value in Dokploy -> **Redeploy** the affected application.
2. Update any mirrored copy in GitHub Actions secrets (`BRIDGE_API_KEY` for the health check).
3. Update the HappyRobot workflow's outbound API key headers to match.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard loads but Convex queries fail | `VITE_CONVEX_URL` not set as Build Arg | Set it under Build Args and click **Redeploy** (not just Restart) |
| API container restarts in a loop | Missing required env var | Check `apps/api` logs; compare against `.env.example` |
| HTTPS cert not issued | DNS not propagated or port 80/443 blocked | Confirm A records and that Hostinger firewall allows 80/443 |
| Push to `main` didn't trigger a build | GitHub App not installed on the repo | Reinstall the Dokploy GitHub App against this repo |
| API boots but no traces in SigNoz | `signoz-net` not attached to the API app | In Dokploy -> api -> Advanced -> Networks, attach `signoz-net` and Redeploy |
| API boots but `iii-stream` / `iii-state` errors | `REDIS_URL` unreachable | Confirm the Redis app is running and reachable at `redis://redis:6379` |

## 9. Observability Stack (SigNoz)

The API pushes OpenTelemetry traces, metrics, and logs to a self-hosted
[SigNoz](https://signoz.io/) instance over OTLP. Set it up once per VPS.

### 9.1 Deploy Redis (required by Motia iii runtime)

1. In your `carrier-sales` project, click **Create Service -> Template**.
2. Pick **Redis** (Dokploy provides a built-in template).
3. Accept the defaults. Redis will be reachable on the internal network at
   `redis://redis:6379`. Do **not** publish it to the host.

### 9.2 Deploy SigNoz (Docker Compose app)

1. **Create Application -> Docker Compose**
2. **Source**: this repo, branch `main`.
3. **Compose Path**: `infra/signoz/docker-compose.yml`
4. **Environment** (Env tab):
   ```env
   SIGNOZ_REF=v0.119.0
   SIGNOZ_VERSION=v0.119.0
   SIGNOZ_OTELCOL_VERSION=v0.144.2
   SIGNOZ_UI_PORT=8080
   SIGNOZ_JWT_SECRET=<openssl rand -base64 32>
   ```
5. **Domain**: host `signoz.<yourdomain>`, container port `8080`, HTTPS on.
6. Click **Deploy**. First boot takes ~3 minutes (ClickHouse migrations). The
   `bootstrap-configs` init container pulls the matching upstream config
   files; watch the logs until it prints `Bootstrapped SigNoz configs`.

### 9.3 Wire the API into SigNoz

1. Open the `api` application -> **Advanced -> Networks**.
2. Attach the `signoz-net` Docker network (created by the compose above).
3. Confirm the `OTEL_*` env vars from [section 3.6](#3-create-the-api-application)
   are set.
4. Redeploy the `api` application.

### 9.4 Verify

```bash
# Hit the API -- this emits one wide-event log line + one trace.
curl -H "x-api-key: $BRIDGE_API_KEY" https://api.<yourdomain>/api/v1/health

# From your browser:
open https://signoz.<yourdomain>
```

In SigNoz:
- **Services** tab: `carrier-sales-api` appears.
- **Traces**: the `GET /api/v1/health` span, attribute `trace.id` matches the
  `trace_id` field in the wide-event log.
- **Logs**: one structured log per request with `outcome`, `duration_ms`,
  `status_code`, and any enriched business fields.
- **Metrics**: custom meters under `carrier_sales.*` (negotiation.rounds,
  booking.outcome, carrier.verification, ...).

### 9.5 Sampling & retention

- App-side sampling (`shouldEmit` in
  [`apps/api/src/observability/wide-event.ts`](../apps/api/src/observability/wide-event.ts))
  always keeps errors, slow requests (> `WIDE_EVENT_SLOW_MS`, default 2000 ms),
  and requests with `x-debug: 1`; samples successes at
  `WIDE_EVENT_SUCCESS_SAMPLE_RATE` (default 1.0). Tune this env on the `api`
  app when log volume becomes an issue.
- Trace sampling is `sampling_ratio: 1.0` in
  [`apps/api/config-production.yaml`](../apps/api/config-production.yaml);
  drop to 0.1 once volume is high.
- SigNoz retention: defaults to 7 days (traces/logs), 30 days (metrics).
  Change it in the SigNoz UI under **Settings -> General**.
