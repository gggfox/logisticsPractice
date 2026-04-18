# Observability

The API emits three telemetry streams to SigNoz over **OTLP-HTTP** (port
`4318`). Exporters are configured in
[`apps/api/src/otel.ts`](../apps/api/src/otel.ts); the OTel Node SDK is
started before any other import in [`apps/api/src/server.ts`](../apps/api/src/server.ts)
so auto-instrumentation patches modules on first load.

- **Traces** — auto-instrumented spans for Fastify (HTTP server), ioredis,
  BullMQ (via `@appsignal/opentelemetry-instrumentation-bullmq`), and
  outbound `http`/`https` calls. No manual span wiring.
- **Metrics** — custom domain meters under `carrier_sales.*` plus Node
  runtime metrics from auto-instrumentation
  (see [`apps/api/src/observability/metrics.ts`](../apps/api/src/observability/metrics.ts)).
- **Logs** — one **wide event** per request / queue job / cron tick,
  correlated to the trace via `trace_id` (pulled from the active span
  with `trace.getActiveSpan()`).

This doc covers the wide-event contract. For infrastructure setup see
[`dokploy-setup.md` § 9](./dokploy-setup.md#9-observability-stack-signoz).

## Why wide events

One enriched, structured log line per request / queue message / cron tick,
emitted at the tail. Inspired by
[loggingsucks.com](https://loggingsucks.com/) and Stripe's
[canonical log lines](https://stripe.com/blog/canonical-log-lines).

Compared to the traditional `logger.info('start')` / `logger.info('done')`
bracket pattern:

- High-cardinality business fields (`call_id`, `mc_number`, `load_id`,
  `offered_rate`) go on the event, not buried in message strings.
- One event per invocation = one row in SigNoz = trivial SQL group-bys.
- Tail-emission lets us compute `duration_ms`, `status_code`, and `outcome`
  in a single place.
- Errors always include a structured `error` object.

## Contract

Every wide event includes:

| Field                | Type                   | Notes                                     |
|----------------------|------------------------|-------------------------------------------|
| `timestamp`          | ISO-8601 string        | Event start (not end).                    |
| `service`            | string                 | `OTEL_SERVICE_NAME`.                      |
| `service_version`    | string                 | `SERVICE_VERSION` (git sha in prod).      |
| `service_namespace`  | string                 | `development` / `production`.             |
| `deployment_region`  | string                 | `DEPLOYMENT_REGION` (e.g. `hostinger-eu`).|
| `step_name`          | string                 | Handler name (`FindLoad`, `ClassifyCall`, ...). Kept as `step_name` for dashboard compatibility even though the Fastify backend calls these "routes" / "workers" / "crons". |
| `trigger_type`       | `api` / `queue` / `cron` | -                                       |
| `trigger_path`       | string?                | HTTP path for api triggers.               |
| `trigger_method`     | string?                | HTTP method for api triggers.             |
| `trigger_topic`      | string?                | BullMQ queue name for queue triggers; cron pattern for cron triggers. |
| `trace_id`           | string                 | W3C trace id from the active OTel span. Joins to spans in SigNoz. |
| `outcome`            | `success` / `error` / `rejected` | `rejected` = 4xx, `error` = 5xx or throw. |
| `duration_ms`        | number                 | Computed in `emitWideEvent`.              |
| `status_code`        | number?                | HTTP only.                                |
| `error`              | `{type, message, code?, retriable?}` | Only on failure.                  |

### HTTP-specific base fields

Added by the `wideEvent` Fastify plugin
([`apps/api/src/plugins/wide-event.ts`](../apps/api/src/plugins/wide-event.ts))
in its `onRequest` hook:

| Field          | Notes                                                   |
|----------------|---------------------------------------------------------|
| `http_method`  | Mirrors `trigger_method`.                               |
| `http_path`    | Truncated to 200 chars.                                 |
| `api_key_hash` | First 12 chars of `sha256(x-api-key)`. **Never** the raw key. |
| `user_agent`   | From `User-Agent` header.                               |
| `ip`           | `X-Forwarded-For` / `X-Real-IP`.                        |

### Per-handler business fields

Enriched by handlers via `enrichWideEvent(req, { ... })` inside a Fastify
route, or via the `enrich(...)` callback passed by `withWideEvent` in a
BullMQ worker / cron tick.

| Step                         | Business fields                                                          |
|------------------------------|--------------------------------------------------------------------------|
| `FindLoad`                   | `load_id`, `found`, `load_status`, `loadboard_rate`, `origin`, `destination`, `equipment_type` |
| `FindLoads`                  | `origin`, `destination`, `equipment_type`, `pickup_date`, `result_count` |
| `FindCarrier`                | `mc_number`, `eligible`, `legal_name`, `operating_status`, `reason`, `enqueued_enrichment` |
| `LogOffer`                   | `call_id`, `load_id`, `carrier_mc`, `round`, `offered_rate`, `counter_rate`, `accepted`, `loadboard_rate`, `max_rounds_reached`, `discount_percent` |
| `CallCompletedWebhook`       | `call_id`, `signature_state`, `call_status`, `has_transcript`, `duration_seconds`, `enqueued` |
| `GetCallTranscript`          | `call_id`, `transcript_length`                                           |
| `HealthCheck`                | `probe: true`                                                            |
| `SeedLoads`                  | `admin_auth_ok`, `seeded_count`                                          |
| `ClassifyCall`               | `call_id`, `outcome`, `negotiation_rounds`, `final_rate`, `transcript_length`, `duration_seconds` |
| `AnalyzeSentiment`           | `call_id`, `sentiment`, `confidence`, `had_transcript`, `skipped`        |
| `VerifyCarrierEnrichment`    | `mc_number`, `legal_name`, `enrichment_source`, `fields_enriched`        |
| `AggregateMetrics`           | `total_calls`, `booked_calls`, `booking_rate`, `revenue_booked`, `avg_negotiation_rounds`, `avg_discount_percent`, `top_lane_*` |

## Sampling

`shouldEmit` (in
[`apps/api/src/observability/wide-event.ts`](../apps/api/src/observability/wide-event.ts))
always keeps:

- `outcome === 'error'`
- `status_code >= 500`
- `duration_ms > WIDE_EVENT_SLOW_MS` (default `2000`)
- requests with header `x-debug: 1`

All other events are sampled at `WIDE_EVENT_SUCCESS_SAMPLE_RATE` (default
`1.0` = keep everything). Lower it (e.g. `0.1`) on the `api` app in Dokploy
once volume becomes painful.

Trace sampling is controlled by the OTel Node SDK via
`OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` env vars. The default
is `parentbased_always_on` (1.0). Set
`OTEL_TRACES_SAMPLER=parentbased_traceidratio` and
`OTEL_TRACES_SAMPLER_ARG=0.1` to drop to 10 % once volume is high.

## Usage

### Fastify route

```ts
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

const ParamsSchema = z.object({ id: z.string().min(1) })

const myRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/widgets/:id',
    { schema: { params: ParamsSchema } },
    async (req, reply) => {
      const { id } = req.params
      enrichWideEvent(req, { widget_id: id })

      const widget = await db.widgets.get(id)
      enrichWideEvent(req, { found: widget != null })

      if (!widget) return reply.code(404).send({ error: 'Not Found', statusCode: 404 })
      return widget
    },
  )
}

export default myRoute
```

The `wideEvent` plugin emits exactly one wide event from its `onResponse`
/ `onError` hook, capturing `status_code`, `duration_ms`, and any error.

### BullMQ worker

```ts
import { Worker } from 'bullmq'
import { logger } from '../logger.js'
import { withWideEvent } from '../observability/wide-event.js'
import {
  QUEUE_NAMES,
  type ProcessWidgetInput,
  ProcessWidgetInputSchema,
  getRedisConnection,
} from '../queues/index.js'

export function createProcessWidgetWorker(): Worker<ProcessWidgetInput> {
  return new Worker<ProcessWidgetInput>(
    QUEUE_NAMES.processWidget,
    async (job) => {
      const data = ProcessWidgetInputSchema.parse(job.data)
      await withWideEvent(
        'ProcessWidget',
        { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.processWidget } },
        async (enrich) => {
          enrich({ widget_id: data.id })
          const result = await process(data)
          enrich({ items_processed: result.count })
        },
      )
    },
    { connection: getRedisConnection() },
  )
}
```

### Croner cron tick

```ts
import { Cron } from 'croner'
import { logger } from '../logger.js'
import { withWideEvent } from '../observability/wide-event.js'

new Cron('0 * * * *', { protect: true }, async () => {
  await withWideEvent(
    'AggregateMetrics',
    { logger, seed: { trigger_type: 'cron', trigger_topic: '0 * * * *' } },
    async (enrich) => {
      enrich({ total: 0 })
      // ...
    },
  )
})
```

## Adding a domain metric

1. Add the instrument to
   [`apps/api/src/observability/metrics.ts`](../apps/api/src/observability/metrics.ts):
   ```ts
   export const myCounter = meter.createCounter('carrier_sales.my.counter', {
     description: 'What this counts',
   })
   ```
2. Record from the step handler with **low-cardinality** attributes only:
   ```ts
   myCounter.add(1, { outcome: 'accepted' }) // ok
   myCounter.add(1, { call_id: input.call_id }) // BAD -- puts call_id in metrics, explodes cardinality
   ```
3. The wide event is where high-cardinality fields go; metrics are for
   aggregate dashboards.

## Local development

OTel is **off by default** in local dev. `pnpm dev` runs `tsx watch
src/server.ts` and honours `OTEL_ENABLED` from the loaded `.env`; the
checked-in [`.env.example`](../.env.example) sets `OTEL_ENABLED=false`.
Wide events still print to the console via Pino, so you get the useful
signal without any exporter running.

> **Why off?** The production `.env` uses
> `OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-otel-collector:4318`, a
> docker-network DNS name that only resolves inside the `signoz-net`
> bridge created by [`infra/signoz/docker-compose.yml`](../infra/signoz/docker-compose.yml).
> From the host it errors with `failed to lookup address information`,
> which spams logs every 5s and stalls graceful shutdown while the OTel
> SDK tries to flush one last batch. Keep OTel off locally unless
> you've actually wired up a reachable collector.

To push traces to a local SigNoz instance, pick one of:

1. **Publish the OTLP-HTTP collector port to the host.** In
   [`infra/signoz/docker-compose.yml`](../infra/signoz/docker-compose.yml),
   add a `ports:` block to the `otel-collector` service (`"4318:4318"`),
   then set in your `.env`:

   ```bash
   OTEL_ENABLED=true
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```

2. **Run the API inside the SigNoz network.** Attach your API container
   to `signoz-net` and leave
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-otel-collector:4318`.
   Only useful if you're already running the API from docker locally.

> **Why 4318 (HTTP) and not 4317 (gRPC)?** The runtime uses the
> `@opentelemetry/exporter-*-otlp-http` family so the image does not pull
> in `@grpc/grpc-js` and its native bindings. HTTP is the default the
> SigNoz collector speaks on `4318`; gRPC on `4317` is not used.
