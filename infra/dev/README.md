# Local-dev infrastructure

Three ways to run the stack locally, from fewest moving parts to most.

## Recommended: `pnpm dev:all` (everything in Docker, one command)

Boots api + dashboard + Redis + the full SigNoz stack, with source
bind-mounted from the host and hot reload working in both apps:

```bash
pnpm dev:all
```

This is a thin wrapper over
[`docker-compose.dev.yml`](../../docker-compose.dev.yml) which uses
`include:` to pull in [`infra/signoz/docker-compose.yml`](../signoz/docker-compose.yml)
and [`infra/signoz/docker-compose.dev.override.yml`](../signoz/docker-compose.dev.override.yml).

What you get:

| Service    | Host URL                | Notes                                 |
| ---------- | ----------------------- | ------------------------------------- |
| API        | http://localhost:3111   | Fastify; tsx watch auto-reloads       |
| API stream | http://localhost:3112   | Reserved (legacy, unused by Fastify)  |
| Dashboard  | http://localhost:3000   | Vite dev + HMR                        |
| Redis      | redis://localhost:6379  | BullMQ backend                        |
| SigNoz UI  | http://localhost:8080   | Traces/metrics/logs                   |

Tear down:

```bash
pnpm dev:all:down
```

Stream just the app logs (Redis/SigNoz kept quiet):

```bash
pnpm dev:all:logs
```

### Under the hood

- [`apps/api/Dockerfile.dev`](../../apps/api/Dockerfile.dev) and
  [`apps/dashboard/Dockerfile.dev`](../../apps/dashboard/Dockerfile.dev)
  are single-stage dev images with `pnpm install --frozen-lockfile`
  baked in. The prod images under `apps/*/Dockerfile` are untouched.
- Source is bind-mounted (`./apps/*`, `./packages`). `node_modules`
  lives in named volumes so the container's install is never shadowed
  by whatever is on the host.
- `CHOKIDAR_USEPOLLING=true` is set in the compose so tsx/vite pick up
  bind-mounted file events on macOS, where inotify through
  osxfs/gRPC-FUSE is unreliable.
- The api container attaches to both `default` (for Redis) and the
  external `signoz-net` (for the OTel collector), and the compose
  overrides `REDIS_URL` + `OTEL_EXPORTER_OTLP_ENDPOINT` so the host-
  facing values in `.env` keep working for direct `pnpm dev`.

## Minimal: Redis only, apps on host

If SigNoz feels heavy and you don't need traces, bring up just Redis
and run the apps natively:

```bash
docker compose -f infra/dev/docker-compose.yml up -d
pnpm dev
```

Set `OTEL_ENABLED=false` in `.env` (or leave it `true` at your own
peril -- without a collector reachable at `localhost:4317` the OTel
SDK will log export failures).

## Traces without full Docker apps

Run the apps natively but ship traces to a locally-published SigNoz:

```bash
docker compose -f infra/dev/docker-compose.yml up -d
docker compose \
  -f infra/signoz/docker-compose.yml \
  -f infra/signoz/docker-compose.dev.override.yml \
  up -d
pnpm dev
```

The `dev.override.yml` in `infra/signoz/` publishes the collector on
`localhost:4317` / `4318` for this exact case; the base SigNoz compose
keeps them internal so prod (Dokploy) stays unaffected.

## Verify

```bash
curl -sS http://localhost:3111/api/v1/health   # api
curl -sS http://localhost:3000/                # dashboard
redis-cli -p 6379 ping                         # -> PONG
nc -zv localhost 4317                          # only if SigNoz is up
```

API logs should show `BullMQ workers started` and no `ECONNREFUSED`
/ `ENOTFOUND` loops.

## Tear down

```bash
pnpm dev:all:down                                              # full stack
docker compose -f infra/dev/docker-compose.yml down            # redis only
docker compose \
  -f infra/signoz/docker-compose.yml \
  -f infra/signoz/docker-compose.dev.override.yml \
  down                                                         # signoz only
```
