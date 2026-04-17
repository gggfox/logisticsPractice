---
name: motia-steps
description: Author Motia steps (HTTP, queue, cron) for apps/api with the project's required config/handler/middleware/observability shape. Use when creating or modifying files under apps/api/src/steps, wiring a new endpoint, webhook, queue consumer, or cron job, or when a step fails typecheck around config/handler/responseSchema.
---

# Motia step authoring

Motia is the workflow engine powering `apps/api`. Every file under
`apps/api/src/steps/**` defines one step via two exports: `config` (static
metadata: trigger, middleware, schemas, flows, enqueues) and `handler` (the
function Motia invokes). This skill codifies the project-local conventions
that are **not** obvious from Motia's own docs.

Quick reference: `.cursor/rules/motia-steps.mdc`. Live examples:
[examples.md](examples.md). Related: `.cursor/rules/wide-event-logging.mdc`.

## Three step trigger kinds

| Trigger | Used in | Handler signature | Observability |
| --- | --- | --- | --- |
| `api(method, path, opts)` | `steps/bridge/**`, `steps/webhooks/**` | `(req, ctx)` | `enrichWideEvent(ctx, {...})` + `wideEventMiddleware` last in `middleware` |
| `queue('topic', { input })` | `steps/processing/**` | `(input, ctx)` | `withWideEvent('Name', ctx, async (enrich) => {...})` |
| `cron(expr)` | `steps/cron/**` | `(_, ctx)` | `withWideEvent('Name', ctx, async (enrich) => {...})` |

Do not mix patterns (e.g. HTTP step using `withWideEvent`, cron using
`enrichWideEvent` alone). The middleware only runs for `api(...)` triggers.

## Required skeleton (copy this, then fill in)

```ts
import { type Handlers, type StepConfig, api } from 'motia'
import { SomeSchema } from '@carrier-sales/shared'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

export const config = {
  name: 'StepName',
  description: 'One-line human summary',
  triggers: [
    api('POST', '/api/v1/path', {
      bodySchema: InputSchema,
      responseSchema: { 200: asStepSchema(OutputSchema) },
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  // ...
}
```

The two non-negotiables:

- `as const satisfies StepConfig` on `config` -- gives `Handlers<typeof config>`
  its types. Without it `req.body` / `req.pathParams` degrade to `any`.
- `asStepSchema(...)` wrapping on every `responseSchema` entry -- the shared
  schemas are Zod v3, Motia expects v4; the helper is the single audited cast.
  Passing a raw schema compiles once and breaks the next time `motia` bumps.

## Middleware order (exact, not suggestive)

HTTP bridge endpoint (`steps/bridge/**`):

```ts
middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware]
```

Webhook endpoint (`steps/webhooks/**`, signature-verified, public-ish):

```ts
middleware: [apiKeyAuth, wideEventMiddleware]
```

`wideEventMiddleware` is **always last**. It runs on response so it can
observe the final status + enriched fields. Anything after it doesn't get
logged.

## Response shape

Success body = your `OutputSchema`. Error body is exactly:

```ts
{ error: '<HTTP phrase>', message: '<human message>', statusCode: <status> }
```

Never throw for a 4xx you can predict (not-found, validation, auth). Return
the error body. Throw only for unexpected state -- the outer `try/catch`
turns those into 500.

## Observability inside the handler

Three rules:

1. Enrich early with identifying ids (`call_id`, `load_id`, `mc_number`) so
   the event is correlatable even if you return non-2xx right away.
2. Enrich again at every branch with the **outcome** (booleans, status
   strings, computed rates). Avoid duplicate keys -- later calls overwrite.
3. In every `catch`, add `failure_stage: '<stage>'` to locate the failure.

```ts
enrichWideEvent(ctx, { load_id })                       // always
enrichWideEvent(ctx, { found: load != null })           // branch
enrichWideEvent(ctx, { failure_stage: 'convex_lookup' }) // catch
```

For queue/cron, the equivalent is:

```ts
withWideEvent('StepName', ctx, async (enrich) => {
  enrich({ call_id: input.call_id })
  // ...
  enrich({ outcome, final_rate })
})
```

Never emit a second canonical `logger.info` -- the wide event is the log.
`logger.warn` / `logger.error` are reserved for standalone signals that need
alerting regardless of the request outcome (e.g. "invalid webhook signature").

## Body schemas

- `bodySchema: InputSchema` auto-validates; Motia rejects invalid input
  before your handler runs.
- For **typed access** in code (e.g. `parsed.data.call_id`), re-parse with
  `SomeSchema.safeParse(req.body)` and branch on `parsed.success`. Emit
  `validation_error: parsed.error.message` on the wide event when it fails.
- `req.pathParams` is `Record<string, string>` -- cast the one you expect:
  `const { load_id } = req.pathParams as { load_id: string }`.

## Enqueueing work

Declare every topic you publish:

```ts
export const config = {
  // ...
  enqueues: ['negotiation.logged'],
  flows: ['bridge-api'],
} as const satisfies StepConfig
```

Then inside the handler:

```ts
await ctx.enqueue({
  topic: 'negotiation.logged',
  data: { call_id, load_id, round, accepted },
})
```

Forgetting `enqueues` is a type error -- don't `as any` around it; add the
topic.

The matching consumer lives in `steps/processing/*.step.ts` as a
`queue('negotiation.logged', { input: InputSchema })` trigger.

## Metrics vs wide-event fields

Metric counters / histograms (`bookingOutcomeCounter`,
`negotiationRoundsHistogram`, `callOutcomeCounter`, `webhookReceivedCounter`)
must only receive LOW-cardinality attributes:

```ts
bookingOutcomeCounter.add(1, { result: 'accepted', round: String(round) })
```

Never put `call_id`, `load_id`, `mc_number`, raw rates, or user inputs into
metric attributes. They go on the wide event.

## Flows

Current flow groups:

- `bridge-api` -- public HTTP endpoints the HappyRobot bridge calls
- `webhook-processing` -- inbound webhooks + their queue consumers
- `metrics` -- cron aggregations

Prefer reusing over inventing a new flow. New flows should correspond to a
new subsystem (e.g. `billing`), not a new endpoint.

## Verification checklist

Before committing a new/edited step:

- [ ] `config` uses `as const satisfies StepConfig`
- [ ] `handler` uses `Handlers<typeof config>`
- [ ] Middleware order matches table above; `wideEventMiddleware` is last
- [ ] Every `responseSchema` entry is wrapped in `asStepSchema(...)`
- [ ] Error responses use `{ error, message, statusCode }`
- [ ] Every branch enriches the wide event; `catch` sets `failure_stage`
- [ ] `ctx.enqueue` topics are listed in `config.enqueues`
- [ ] Metric attributes are low-cardinality strings
- [ ] `flows` references an existing group

## Live files to copy from

See [examples.md](examples.md) for a full HTTP step, webhook step, queue
consumer, and cron step lifted verbatim from the repo.
