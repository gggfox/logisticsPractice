---
name: fastify-routes
description: Author Fastify routes, BullMQ workers, and Croner cron jobs for apps/api with the project's required plugin/handler/observability shape. Use when creating or modifying files under apps/api/src/routes, apps/api/src/workers, or apps/api/src/cron, wiring a new endpoint, webhook, queue consumer, or cron job, or when a handler fails typecheck around Zod schemas or wide-event enrichment.
---

# Fastify route authoring

`apps/api` is a Fastify 5 app with three kinds of work surfaces, each
in its own directory:

- `apps/api/src/routes/**` -- HTTP handlers (Zod-validated, typed via
  `fastify-type-provider-zod`)
- `apps/api/src/workers/**` -- BullMQ queue consumers (one file per
  worker, started from `workers/index.ts`)
- `apps/api/src/cron/**` -- Croner scheduled jobs (started / stopped
  from `server.ts`)

This skill codifies the project-local conventions on top of what those
libraries document.

Quick reference: `.cursor/rules/fastify-routes.mdc`. Live examples:
[examples.md](examples.md). Related:
`.cursor/rules/wide-event-logging.mdc`.

## Three work surfaces

| Kind | Directory | Signature | Observability |
| --- | --- | --- | --- |
| HTTP route | `routes/**` | `async (req, reply) => ...` inside a `FastifyPluginAsync` | `enrichWideEvent(req, { ... })` + global `wideEvent` plugin |
| Queue worker | `workers/**` | `new Worker(name, async (job) => ..., { connection })` | `withWideEvent('Name', { logger, seed }, async (enrich) => { ... })` |
| Cron job | `cron/**` | `new Cron(expr, { protect: true }, () => { runJob() })` | `withWideEvent('Name', { logger, seed: { trigger_type: 'cron' } }, ...)` |

Do not mix patterns (e.g. HTTP route using `withWideEvent`, cron
using `enrichWideEvent` alone). The wide-event plugin only runs for
Fastify requests.

## Required route skeleton (copy this, then fill in)

```ts
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { SomeInputSchema, SomeOutputSchema } from '@carrier-sales/shared'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { ErrorBodySchema } from '../_error-schema.js'

const route: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/path',
    {
      schema: {
        tags: ['domain'],
        summary: 'One-line human summary',
        body: SomeInputSchema,
        response: {
          200: SomeOutputSchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      enrichWideEvent(req, { /* identifying ids */ })
      try {
        // ...
        return { /* matches OutputSchema */ }
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'something' })
        req.log.error({ err }, 'Failed to ...')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to ...',
          statusCode: 500,
        })
      }
    },
  )
}

export default route
```

The two non-negotiables:

- `.withTypeProvider<ZodTypeProvider>()` so `req.body` / `req.query` /
  `req.params` are typed from the Zod schemas. Without it they're
  `unknown` and you'll be tempted to cast.
- Register the route file in `apps/api/src/routes/index.ts`. A route
  that isn't registered there is never mounted -- Fastify won't warn.

## Plugin / middleware order (registered in `server.ts`)

```
securityHeaders -> rateLimiter -> apiKeyAuth -> wideEvent
```

`server.ts` registers these globally before `routes`. Don't
re-register per route.

- `apiKeyAuth` (`plugins/api-key-auth.ts`) is a `preHandler` hook that
  bypasses `/api/v1/health` and accepts `?api_key=...` only under
  `/docs/**` (Swagger UI fallback).
- `wideEvent` (`plugins/wide-event.ts`) runs on response via
  `onResponse`, so it observes the final status + enriched fields.
- Webhook routes add route-level `config: { rawBody: true }` to opt
  into `fastify-raw-body` for HMAC verification.

## Schemas

- `body` / `querystring` / `params` in the route's `schema` are
  validated by the Zod provider before the handler runs. Invalid
  input auto-400s with a Zod error message.
- `response: { <status>: Schema }` enables response serialization.
  **Omit** the schema when Convex widens a field (e.g. enum ->
  string) and it would break the handler return type; the canonical
  contract still lives in `@carrier-sales/shared`.
- Never `as any` a schema through. If you hit a Zod v3/v4 mismatch,
  use `asStepSchema` from `apps/api/src/lib/zod-schema.ts` -- the
  single audited bridge.

## Response shape

Success body = your output schema. Error body is exactly:

```ts
{ error: '<HTTP phrase>', message: '<human message>', statusCode: <status> }
```

Use `ErrorBodySchema` from `routes/_error-schema.ts` in the `response`
map for anything that can 4xx/5xx.

Never `throw` for a predictable 4xx (not-found, validation, auth).
Use `reply.code(...).send(...)`. Unexpected errors propagate to the
global error handler in `server.ts`, which returns a 500 in the same
shape.

## Observability inside a handler

Three rules:

1. Enrich early with identifying ids (`call_id`, `load_id`,
   `mc_number`) so the event is correlatable even if you return
   non-2xx right away.
2. Enrich again at every branch with the **outcome** (booleans,
   status strings, computed rates). Avoid duplicate keys -- later
   calls overwrite.
3. In every `catch`, add `failure_stage: '<stage>'` to locate the
   failure.

```ts
enrichWideEvent(req, { load_id })                         // always
enrichWideEvent(req, { found: load != null })             // branch
enrichWideEvent(req, { failure_stage: 'convex_lookup' })  // catch
```

For workers / cron, the equivalent is:

```ts
await withWideEvent(
  'Name',
  { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.x } },
  async (enrich) => {
    enrich({ call_id: data.call_id })
    // ...
    enrich({ outcome, final_rate })
  },
)
```

Never emit a second canonical `logger.info` -- the wide event is the
log. `logger.warn` / `logger.error` are reserved for standalone
signals that need alerting regardless of the request outcome (e.g.
"invalid webhook signature").

## Enqueueing work

Topics and input schemas live in `apps/api/src/queues/index.ts`:

```ts
export const QUEUE_NAMES = {
  classifyCall: 'call.completed.classify',
  analyzeSentiment: 'call.completed.sentiment',
  verifyCarrier: 'carrier.verified',
} as const

export const ClassifyCallInputSchema = z.object({ /* ... */ })
export type ClassifyCallInput = z.infer<typeof ClassifyCallInputSchema>
```

Producer (inside a route):

```ts
await getClassifyCallQueue().add('classify', {
  call_id, carrier_mc, load_id, transcript, /* ... */
})
```

Consumer (in `workers/classify-call.worker.ts`):

```ts
new Worker<ClassifyCallInput>(
  QUEUE_NAMES.classifyCall,
  async (job) => {
    const data = ClassifyCallInputSchema.parse(job.data)  // validate!
    await withWideEvent('ClassifyCall', { logger, seed: {...} }, async (enrich) => {
      // ...
    })
  },
  { connection: getRedisConnection() },
)
```

Always `Schema.parse(job.data)` at the top of a worker -- the producer
is typed but the queue payload is JSON on the wire.

## Metrics vs wide-event fields

Metric counters / histograms (`bookingOutcomeCounter`,
`negotiationRoundsHistogram`, `callOutcomeCounter`,
`webhookReceivedCounter`) must only receive LOW-cardinality attributes:

```ts
bookingOutcomeCounter.add(1, { result: 'accepted', round: String(round) })
```

Never put `call_id`, `load_id`, `mc_number`, raw rates, or user inputs
into metric attributes. They go on the wide event.

## Verification checklist

Before committing a new / edited route, worker, or cron:

- [ ] HTTP route uses `.withTypeProvider<ZodTypeProvider>()`
- [ ] Route file is registered in `routes/index.ts`
- [ ] Worker file is started from `workers/index.ts`
- [ ] `body` / `querystring` / `params` are Zod schemas in `schema`
- [ ] `response` map uses `ErrorBodySchema` for error statuses
- [ ] Error responses use `{ error, message, statusCode }` shape
- [ ] Every branch enriches the wide event; `catch` sets
      `failure_stage`
- [ ] Worker handler calls `Schema.parse(job.data)` at the top
- [ ] Metric attributes are low-cardinality strings
- [ ] Webhook route sets `config: { rawBody: true }` if it HMACs

## Live files to copy from

See [examples.md](examples.md) for a full HTTP route, webhook route,
queue worker, and cron job lifted verbatim from the repo.
