# Fastify route examples

Verbatim copies of live handlers in `apps/api/src`. Copy, rename, edit.

## 1. HTTP GET with path param + Convex lookup

`apps/api/src/routes/bridge/find-load.ts`

```ts
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

const ParamsSchema = z.object({
  load_id: z.string().min(1),
})

const findLoadRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/loads/:load_id',
    {
      schema: {
        tags: ['loads'],
        summary: 'Get a load by load_id',
        params: ParamsSchema,
      },
    },
    async (req, reply) => {
      const { load_id } = req.params
      enrichWideEvent(req, { load_id })

      try {
        const load = await convexService.loads.getByLoadId(load_id)
        enrichWideEvent(req, { found: load != null })

        if (!load) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `Load ${load_id} not found`,
            statusCode: 404,
          })
        }

        enrichWideEvent(req, {
          load_status: load.status,
          loadboard_rate: load.loadboard_rate,
        })
        return load
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'convex_lookup' })
        req.log.error({ err, load_id }, 'Failed to fetch load')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch load',
          statusCode: 500,
        })
      }
    },
  )
}

export default findLoadRoute
```

Takeaways: Zod-typed params via the type provider, early enrich, 404
without throwing, `failure_stage` in catch.

## 2. HTTP POST with body schema + queue enqueue

`apps/api/src/routes/bridge/log-offer.ts` (abridged)

```ts
import {
  MAX_NEGOTIATION_ROUNDS,
  OfferRequestSchema,
  OfferResponseSchema,
} from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { bookingOutcomeCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'
import { ErrorBodySchema } from '../_error-schema.js'

const logOfferRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/offers',
    {
      schema: {
        tags: ['offers'],
        summary: 'Submit a carrier offer (negotiation round)',
        body: OfferRequestSchema,
        response: {
          200: OfferResponseSchema,
          404: ErrorBodySchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const { call_id, load_id, carrier_mc, offered_rate } = req.body
      enrichWideEvent(req, { call_id, load_id, carrier_mc, offered_rate })

      try {
        const load = await convexService.loads.getByLoadId(load_id)
        if (!load) {
          enrichWideEvent(req, { failure_stage: 'load_not_found' })
          return reply.code(404).send({
            error: 'Not Found',
            message: `Load ${load_id} not found`,
            statusCode: 404,
          })
        }

        // ... negotiation logic ...

        bookingOutcomeCounter.add(1, { result: 'accepted', round: String(round) })
        enrichWideEvent(req, { accepted: true })
        return { accepted: true, round, max_rounds_reached: false, message: '...' }
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'offer_processing' })
        req.log.error({ err }, 'Failed to process offer')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to process offer',
          statusCode: 500,
        })
      }
    },
  )
}

export default logOfferRoute
```

Takeaways: `body` schema gives typed `req.body`, `response` map uses
`ErrorBodySchema` for 4xx/5xx, metric attrs are low-cardinality.

## 3. Webhook (raw body + HMAC telemetry + fan-out)

`apps/api/src/routes/webhooks/call-completed.ts` (abridged)

```ts
import { CallWebhookPayloadSchema } from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { webhookReceivedCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { verifyWebhookSignature } from '../../plugins/hmac.js'
import { getAnalyzeSentimentQueue, getClassifyCallQueue } from '../../queues/index.js'
import { ErrorBodySchema } from '../_error-schema.js'

const WebhookAckSchema = z.object({ received: z.literal(true) })

const callCompletedRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/webhooks/call-completed',
    {
      // Capture the raw body so we can HMAC the exact bytes the caller
      // signed. HappyRobot's webhook UI only supports static headers and
      // cannot sign per-request, so the signature is telemetry only --
      // `x-api-key` (global auth plugin) is the auth gate.
      config: { rawBody: true },
      schema: {
        tags: ['webhooks'],
        body: CallWebhookPayloadSchema,
        response: { 200: WebhookAckSchema, 500: ErrorBodySchema },
      },
    },
    async (req, reply) => {
      const hasSignature = typeof req.headers['x-webhook-signature'] === 'string'
      const signatureState: 'valid' | 'invalid' | 'absent' = hasSignature
        ? verifyWebhookSignature(req) ? 'valid' : 'invalid'
        : 'absent'
      enrichWideEvent(req, { signature_state: signatureState })

      const payload = req.body
      webhookReceivedCounter.add(1, {
        signature_state: signatureState,
        status: payload.status,
      })

      try {
        await Promise.all([
          getClassifyCallQueue().add('classify', { /* ... */ }),
          getAnalyzeSentimentQueue().add('sentiment', { /* ... */ }),
        ])
        return { received: true as const }
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'webhook_processing' })
        req.log.error({ err }, 'Webhook processing failed')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Webhook processing failed',
          statusCode: 500,
        })
      }
    },
  )
}

export default callCompletedRoute
```

Takeaways: `config: { rawBody: true }` is route-level opt-in to
`fastify-raw-body`; signature is recorded as telemetry
(`signature_state`), not an auth gate. Fan-out by publishing to two
queues.

## 4. BullMQ queue consumer

`apps/api/src/workers/classify-call.worker.ts` (abridged)

```ts
import { Worker } from 'bullmq'
import { logger } from '../logger.js'
import { callOutcomeCounter } from '../observability/metrics.js'
import { withWideEvent } from '../observability/wide-event.js'
import {
  type ClassifyCallInput,
  ClassifyCallInputSchema,
  QUEUE_NAMES,
  getRedisConnection,
} from '../queues/index.js'
import { convexService } from '../services/convex.service.js'

export function createClassifyCallWorker(): Worker<ClassifyCallInput> {
  const worker = new Worker<ClassifyCallInput>(
    QUEUE_NAMES.classifyCall,
    async (job) => {
      const data = ClassifyCallInputSchema.parse(job.data)

      await withWideEvent(
        'ClassifyCall',
        { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.classifyCall } },
        async (enrich) => {
          enrich({ call_id: data.call_id, carrier_mc: data.carrier_mc })
          // ... classify + persist via convexService ...
          callOutcomeCounter.add(1, { outcome })
          enrich({ outcome })
        },
      )
    },
    { connection: getRedisConnection() },
  )

  worker.on('failed', (job, err) => {
    logger.error(
      { job_id: job?.id, queue: QUEUE_NAMES.classifyCall, err },
      'classify-call worker job failed',
    )
  })

  return worker
}
```

Takeaways: `Schema.parse(job.data)` at the top (JSON on the wire),
`withWideEvent` wraps the whole handler, `worker.on('failed', ...)`
catches anything that escapes.

## 5. Cron (hourly aggregation via Croner)

`apps/api/src/cron/aggregate-metrics.cron.ts` (abridged)

```ts
import { Cron } from 'croner'
import { logger } from '../logger.js'
import { withWideEvent } from '../observability/wide-event.js'
import { convexService } from '../services/convex.service.js'

async function runAggregation(): Promise<void> {
  await withWideEvent(
    'AggregateMetrics',
    { logger, seed: { trigger_type: 'cron', trigger_topic: '0 * * * *' } },
    async (enrich) => {
      const calls = await convexService.calls.getAll()
      // ... cross-table work via Promise.all, see convex-patterns skill ...
      await convexService.metrics.write({ /* ... */ })
      enrich({ total_calls: calls.length })
    },
  )
}

let job: Cron | null = null

export function startAggregateMetricsCron(): void {
  if (job) return
  // Hourly on the hour, single concurrent run, swallow errors so the
  // scheduler keeps ticking.
  job = new Cron('0 * * * *', { protect: true }, () => {
    runAggregation().catch((err) => {
      logger.error({ err }, 'aggregate-metrics cron tick failed')
    })
  })
}

export function stopAggregateMetricsCron(): void {
  job?.stop()
  job = null
}
```

Takeaways: `protect: true` means one concurrent run; swallow errors in
the tick so a bad hour doesn't unhook the schedule; start/stop are
called from `server.ts` for graceful shutdown.
