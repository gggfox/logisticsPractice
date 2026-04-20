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
      // Capture the raw body so that when `x-webhook-signature` is sent we
      // can HMAC the exact bytes the caller signed. HappyRobot's workflow
      // webhook UI only supports static headers and cannot sign per-request,
      // so the signature is optional telemetry -- `x-api-key` (enforced by
      // the global auth plugin) is the only auth gate.
      config: { rawBody: true },
      schema: {
        tags: ['webhooks'],
        summary: 'Inbound HappyRobot call-completed webhook',
        description:
          'Authenticated via `x-api-key` like every other route. `x-webhook-signature` is optional telemetry: if present we record whether it verifies against `WEBHOOK_SECRET`, but it never gates the response. Fans out to the classify and sentiment-analysis BullMQ queues.',
        security: [{ apiKey: [] }],
        body: CallWebhookPayloadSchema,
        response: {
          200: WebhookAckSchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const hasSignature = typeof req.headers['x-webhook-signature'] === 'string'
      let signatureState: 'valid' | 'invalid' | 'absent' = 'absent'
      if (hasSignature) {
        signatureState = verifyWebhookSignature(req) ? 'valid' : 'invalid'
      }
      enrichWideEvent(req, { signature_state: signatureState })

      // HappyRobot's workflow-completed webhook body is a mix of our
      // documented fields (when the user wires them) and their native
      // envelope (run_id/session_id/variables/extraction/...). Normalize
      // here so the rest of the pipeline -- Convex mutations,
      // classify/sentiment workers -- sees a single canonical shape.
      const raw = req.body as Record<string, unknown>
      const pickString = (...values: unknown[]): string | undefined => {
        for (const v of values) {
          if (typeof v === 'string' && v.length > 0) return v
        }
        return undefined
      }
      const pickNumber = (...values: unknown[]): number | undefined => {
        for (const v of values) {
          if (typeof v === 'number' && Number.isFinite(v)) return v
        }
        return undefined
      }
      const vars = (raw.variables ?? {}) as Record<string, unknown>
      const extraction = (raw.extraction ?? {}) as Record<string, unknown>

      const call_id =
        pickString(raw.call_id, raw.run_id, raw.session_id, vars.session_id, vars.call_id) ??
        'unknown'
      const status = pickString(raw.status) ?? 'completed'
      const carrier_mc = pickString(raw.carrier_mc, vars.carrier_mc, vars.mc_number)
      const load_id = pickString(raw.load_id, vars.load_id, vars.reference_number)
      const transcript = pickString(raw.transcript, extraction.transcript) ?? ''
      const duration_seconds = pickNumber(raw.duration_seconds)
      const phone_number = pickString(raw.phone_number, vars.phone_number)
      // Convex requires `started_at: string`; default to now so a
      // timestamp-less envelope doesn't block insert.
      const started_at = pickString(raw.started_at) ?? new Date().toISOString()
      const ended_at = pickString(raw.ended_at)
      const extracted_data =
        (raw.extracted_data as Record<string, unknown> | undefined) ??
        (raw.extraction as Record<string, unknown> | undefined)

      enrichWideEvent(req, {
        call_id,
        call_status: status,
        has_transcript: transcript.length > 0,
        carrier_mc,
        load_id,
        duration_seconds,
        phone_present: Boolean(phone_number),
        // Diagnostic: which top-level keys the caller actually sent. Low-
        // cardinality (sender-stable) and leaks no PII.
        payload_keys: Object.keys(raw)
          .sort((a, b) => a.localeCompare(b))
          .join(','),
      })
      webhookReceivedCounter.add(1, {
        signature_state: signatureState,
        status,
      })

      try {
        // Fan-out: BullMQ workers sharing a queue name compete, so publish
        // to two topics (classify + sentiment) for parallel processing.
        await Promise.all([
          getClassifyCallQueue().add('classify', {
            call_id,
            carrier_mc,
            load_id,
            transcript,
            duration_seconds,
            started_at,
            ended_at: ended_at ?? started_at,
            status,
            extracted_data,
          }),
          getAnalyzeSentimentQueue().add('sentiment', {
            call_id,
            transcript,
          }),
        ])
        enrichWideEvent(req, { enqueued: true })

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
