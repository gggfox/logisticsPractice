# Motia step examples

Verbatim copies of live steps in `apps/api/src/steps/**`. Copy, rename, edit.

## 1. HTTP GET with path param + convex lookup

`apps/api/src/steps/bridge/find-load.step.ts`

```ts
import { LoadSchema } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'FindLoad',
  description: 'Get a single load by ID',
  triggers: [
    api('GET', '/api/v1/loads/:load_id', {
      responseSchema: { 200: asStepSchema(LoadSchema) },
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  const { load_id } = req.pathParams as { load_id: string }
  enrichWideEvent(ctx, { load_id })

  try {
    const load = await convexService.loads.getByLoadId(load_id)
    enrichWideEvent(ctx, { found: load != null })

    if (!load) {
      return {
        status: 404,
        body: { error: 'Not Found', message: `Load ${load_id} not found`, statusCode: 404 },
      }
    }

    enrichWideEvent(ctx, {
      load_status: load.status,
      loadboard_rate: load.loadboard_rate,
    })

    return { status: 200, body: load }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'convex_lookup' })
    ctx.logger.error('Failed to fetch load', { load_id, error })
    return {
      status: 500,
      body: { error: 'Internal Server Error', message: 'Failed to fetch load', statusCode: 500 },
    }
  }
}
```

Takeaways: path param cast, early enrich, 404 without throwing,
`failure_stage` in catch.

## 2. HTTP POST with body schema + enqueue

`apps/api/src/steps/bridge/log-offer.step.ts` (abridged)

```ts
import {
  MAX_NEGOTIATION_ROUNDS,
  OfferRequestSchema,
  OfferResponseSchema,
} from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { bookingOutcomeCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

export const config = {
  name: 'LogOffer',
  triggers: [
    api('POST', '/api/v1/offers', {
      bodySchema: OfferRequestSchema,
      responseSchema: { 200: asStepSchema(OfferResponseSchema) },
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  enqueues: ['negotiation.logged'],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  try {
    const parsed = OfferRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      enrichWideEvent(ctx, { validation_error: parsed.error.message })
      return {
        status: 400,
        body: { error: 'Bad Request', message: parsed.error.message, statusCode: 400 },
      }
    }

    const { call_id, load_id, offered_rate } = parsed.data
    enrichWideEvent(ctx, { call_id, load_id, offered_rate })

    // ... business logic ...

    bookingOutcomeCounter.add(1, { result: 'accepted', round: String(1) })

    await ctx.enqueue({
      topic: 'negotiation.logged',
      data: { call_id, load_id, accepted: true },
    })

    enrichWideEvent(ctx, { accepted: true })
    return { status: 200, body: { /* OfferResponse */ } as never }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'offer_processing' })
    ctx.logger.error('Failed to process offer', { error })
    return {
      status: 500,
      body: { error: 'Internal Server Error', message: 'Failed to process offer', statusCode: 500 },
    }
  }
}
```

Takeaways: `safeParse` for typed branching, `enqueues` declared, metric
attributes are low-cardinality strings only.

## 3. Webhook (no rate limiter, signature verification)

`apps/api/src/steps/webhooks/call-completed.step.ts` (abridged)

```ts
import crypto from 'node:crypto'
import { CallWebhookPayloadSchema } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { config as appConfig } from '../../config.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { webhookReceivedCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

export const config = {
  name: 'CallCompletedWebhook',
  triggers: [
    api('POST', '/api/v1/webhooks/call-completed', {
      bodySchema: CallWebhookPayloadSchema,
      middleware: [apiKeyAuth, wideEventMiddleware],
    }),
  ],
  enqueues: ['call.completed'],
  flows: ['webhook-processing'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  // HappyRobot can only send static headers, so `x-api-key` (already
  // enforced by apiKeyAuth) is the auth gate. The HMAC is optional
  // telemetry: record the outcome but never 401 on it.
  const signature = req.headers['x-webhook-signature']
  const hasSignature = typeof signature === 'string'
  const signatureState: 'valid' | 'invalid' | 'absent' = hasSignature
    ? verifyWebhookSignature(req) ? 'valid' : 'invalid'
    : 'absent'
  enrichWideEvent(ctx, { signature_state: signatureState })

  const parsed = CallWebhookPayloadSchema.safeParse(req.body)
  if (!parsed.success) {
    enrichWideEvent(ctx, { validation_error: parsed.error.message })
    return {
      status: 400,
      body: { error: 'Bad Request', message: parsed.error.message, statusCode: 400 },
    }
  }

  webhookReceivedCounter.add(1, {
    signature_state: signatureState,
    status: parsed.data.status,
  })
  enrichWideEvent(ctx, { call_id: parsed.data.call_id, call_status: parsed.data.status })
  await ctx.enqueue({ topic: 'call.completed', data: parsed.data })
  return { status: 200, body: { received: true } }
}
```

Takeaways: middleware is `[apiKeyAuth, wideEventMiddleware]` only; the
signature is telemetry (`signature_state`), not an auth gate. If you
*do* need a signature-gated webhook (signing proxy, non-HappyRobot
platform), use the `hmacVerifier` fastify plugin from
`apps/api/src/plugins/hmac.ts`, which 401s on failure.

## 4. Queue consumer (processing)

`apps/api/src/steps/processing/classify-call.step.ts` (abridged)

```ts
import { type Handlers, type StepConfig, queue } from 'motia'
import { z } from 'zod'
import { callOutcomeCounter } from '../../observability/metrics.js'
import { withWideEvent } from '../../observability/wide-event.js'
import { convexService } from '../../services/convex.service.js'

const InputSchema = z.object({
  call_id: z.string(),
  started_at: z.string(),
  ended_at: z.string(),
  status: z.string(),
})

export const config = {
  name: 'ClassifyCall',
  triggers: [queue('call.completed', { input: InputSchema })],
  flows: ['webhook-processing'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (input, ctx) =>
  withWideEvent('ClassifyCall', ctx, async (enrich) => {
    enrich({ call_id: input.call_id })
    // ...
    callOutcomeCounter.add(1, { outcome: 'booked' })
    enrich({ outcome: 'booked' })
  })
```

Takeaways: `withWideEvent` wraps the whole handler; no `enrichWideEvent` /
`wideEventMiddleware` for non-HTTP triggers.

## 5. Cron (hourly aggregation)

`apps/api/src/steps/cron/aggregate-metrics.step.ts` (abridged)

```ts
import { type Handlers, type StepConfig, cron } from 'motia'
import { withWideEvent } from '../../observability/wide-event.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'AggregateMetrics',
  triggers: [cron('0 * * * *')],
  flows: ['metrics'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (_, ctx) =>
  withWideEvent('AggregateMetrics', ctx, async (enrich) => {
    const calls = await convexService.calls.getAll()
    // ... cross-table work via Promise.all, see convex-patterns skill ...
    await convexService.metrics.write({ /* ... */ } as never)
    enrich({ total_calls: calls.length })
  })
```

Takeaways: first handler arg is `_`, trigger is a single `cron(expr)`,
`Promise.all` for parallel cross-table reads (see `convex-patterns` skill).
