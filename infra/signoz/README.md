# SigNoz observability stack

Self-hosted [SigNoz](https://signoz.io/) community edition for traces, metrics, and logs.
Deployed alongside the `api` and `dashboard` apps on Dokploy, wired to the Motia
`iii-observability` worker via OTLP.

## Services

| Service               | Purpose                                              | Host port |
|-----------------------|------------------------------------------------------|-----------|
| `signoz`              | Query service + UI (ClickHouse-backed)               | `8080`    |
| `otel-collector`      | OTLP gRPC `4317` / HTTP `4318` receivers             | internal  |
| `clickhouse`          | Columnar store for traces / metrics / logs           | internal  |
| `zookeeper-1`         | ClickHouse coordination                              | internal  |
| `bootstrap-configs`   | One-shot init: pulls SigNoz upstream configs         | -         |
| `init-clickhouse`     | One-shot init: installs `histogramQuantile` UDF      | -         |
| `telemetrystore-migrator` | One-shot init: runs schema migrations            | -         |

The collector ports (`4317`, `4318`) are **not** published to the host. The
`api` container reaches the collector via the Docker network `signoz-net` using
the DNS name `signoz-otel-collector:4317`.

## Deploy on Dokploy

1. **Projects -> carrier-sales -> Create Application**
2. **Type**: Docker Compose
3. **Source**: this repo, branch `main`
4. **Compose path**: `infra/signoz/docker-compose.yml`
5. **Environment** (Env tab):
   ```env
   SIGNOZ_REF=v0.119.0
   SIGNOZ_VERSION=v0.119.0
   SIGNOZ_OTELCOL_VERSION=v0.144.2
   SIGNOZ_UI_PORT=8080
   SIGNOZ_JWT_SECRET=<openssl rand -base64 32>
   ```
6. **Domain**: host `signoz.<yourdomain>`, path `/`, container port `8080`, HTTPS on.
7. **Networks**: create/attach `signoz-net`. Open the `api` application ->
   Advanced -> Networks -> attach `signoz-net` as well.

## Verify

```bash
# From the api container:
docker exec -it <api-container> sh -c 'nc -zv signoz-otel-collector 4317'
# -> signoz-otel-collector (...) open

# From your browser:
open https://signoz.<yourdomain>
```

Create the admin account on first load, then navigate to **Services** to see
`carrier-sales-api` once any request hits the API.

## Sizing

On a 4 GB Hostinger VPS SigNoz needs roughly:

- ClickHouse: 1.5 GB RAM, grows with retention.
- signoz (query + UI): 300 MB.
- otel-collector: 200 MB.
- Zookeeper: 200 MB.

Default retention is 7 days for traces/logs, 30 days for metrics. Change it in
the SigNoz UI under **Settings -> General**.

## Upgrading

Bump `SIGNOZ_REF`, `SIGNOZ_VERSION`, and `SIGNOZ_OTELCOL_VERSION` together,
then redeploy the compose app in Dokploy. The `bootstrap-configs` service will
re-pull the matching upstream configs.
