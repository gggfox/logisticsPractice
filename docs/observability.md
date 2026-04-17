# Observability

The API emits three telemetry streams to SigNoz over OTLP:

- **Traces** — automatic spans per step + HTTP request, via Motia's
  `iii-observability` worker.
- **Metrics** — built-in iii metrics (`http.server.*`, `queue.*`, `state.*`)
  plus custom domain meters under `carrier_sales.*`
  (see [`apps/api/src/observability/metrics.ts`](../apps/api/src/observability/metrics.ts)).
- **Logs** — one **wide event** per handler invocation, correlated to the
  trace via `trace_id`.

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
| `step_name`          | string                 | Motia step name (`FindLoad`, `ClassifyCall`, ...). |
| `trigger_type`       | `api` / `queue` / `cron` | -                                       |
| `trigger_path`       | string?                | HTTP path for api triggers.               |
| `trigger_method`     | string?                | HTTP method for api triggers.             |
| `trigger_topic`      | string?                | Topic for queue triggers.                 |
| `trace_id`           | string                 | W3C trace id from `ctx.traceId`. Used to join with SigNoz spans. |
| `outcome`            | `success` / `error` / `rejected` | `rejected` = 4xx, `error` = 5xx or throw. |
| `duration_ms`        | number                 | Computed in `emitWideEvent`.              |
| `status_code`        | number?                | HTTP only.                                |
| `error`              | `{type, message, code?, retriable?}` | Only on failure.                  |

### HTTP-specific base fields

Added by `wideEventMiddleware`:

| Field          | Notes                                                   |
|----------------|---------------------------------------------------------|
| `http_method`  | Mirrors `trigger_method`.                               |
| `http_path`    | Truncated to 200 chars.                                 |
| `api_key_hash` | First 12 chars of `sha256(x-api-key)`. **Never** the raw key. |
| `user_agent`   | From `User-Agent` header.                               |
| `ip`           | `X-Forwarded-For` / `X-Real-IP`.                        |

### Per-step business fields

Enriched by handlers via `enrichWideEvent(ctx, { ... })` (HTTP) or
`enrich({ ... })` (queue/cron).

| Step                         | Business fields                                                          |
|------------------------------|--------------------------------------------------------------------------|
| `FindLoad`                   | `load_id`, `found`, `load_status`, `loadboard_rate`, `origin`, `destination`, `equipment_type` |
| `FindLoads`                  | `origin`, `destination`, `equipment_type`, `pickup_date`, `result_count` |
| `FindCarrier`                | `mc_number`, `eligible`, `legal_name`, `operating_status`, `reason`, `enqueued_enrichment` |
| `LogOffer`                   | `call_id`, `load_id`, `carrier_mc`, `round`, `offered_rate`, `counter_rate`, `accepted`, `loadboard_rate`, `max_rounds_reached`, `discount_percent` |
| `CallCompletedWebhook`       | `call_id`, `signature_valid`, `call_status`, `has_transcript`, `duration_seconds`, `enqueued` |
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

Trace sampling is separate and lives in
[`apps/api/config-production.yaml`](../apps/api/config-production.yaml) under
`iii-observability.sampling_ratio`.

## Usage

### HTTP step

```ts
import { api, type Handlers, type StepConfig } from 'motia'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

export const config = {
  name: 'MyStep',
  triggers: [
    api('GET', '/api/v1/widgets/:id', {
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  flows: ['widgets'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  const { id } = req.pathParams as { id: string }
  enrichWideEvent(ctx, { widget_id: id })

  const widget = await db.widgets.get(id)
  enrichWideEvent(ctx, { found: widget != null })

  return widget
    ? { status: 200, body: widget }
    : { status: 404, body: { error: 'Not Found', statusCode: 404 } }
}
```

The middleware emits exactly one wide event in `finally`, capturing
`status_code`, `duration_ms`, and any uncaught error.

### Queue / cron step

```ts
import { type Handlers, type StepConfig, queue } from 'motia'
import { withWideEvent } from '../../observability/wide-event.js'

export const config = {
  name: 'ProcessWidget',
  triggers: [queue('widget.created', { input: InputSchema })],
  flows: ['widgets'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (input, ctx) =>
  withWideEvent('ProcessWidget', ctx, async (enrich) => {
    enrich({ widget_id: input.id })
    const result = await process(input)
    enrich({ items_processed: result.count })
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

`motia dev` does not emit OTLP — the `iii-observability` worker only runs
against `config-production.yaml`. Locally, wide events still print to the
console via `ctx.logger.info(...)` for manual inspection. To test against a
real SigNoz instance locally, run `docker compose -f infra/signoz/docker-compose.yml up -d`
then set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317` and run with
`iii --config apps/api/config-production.yaml` instead of `motia dev`.
