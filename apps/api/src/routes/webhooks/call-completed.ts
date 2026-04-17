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
      // Capture the raw body so the HMAC verifier can digest the exact
      // bytes HappyRobot signed instead of a re-serialized copy.
      config: { rawBody: true },
      schema: {
        body: CallWebhookPayloadSchema,
        response: {
          200: WebhookAckSchema,
          401: ErrorBodySchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const signatureValid = verifyWebhookSignature(req)
      enrichWideEvent(req, { signature_valid: signatureValid })

      if (!signatureValid) {
        webhookReceivedCounter.add(1, { signature_valid: 'false' })
        req.log.warn('Invalid webhook signature')
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          statusCode: 401,
        })
      }

      const payload = req.body
      enrichWideEvent(req, {
        call_id: payload.call_id,
        call_status: payload.status,
        has_transcript: Boolean(payload.transcript),
        carrier_mc: payload.carrier_mc,
        load_id: payload.load_id,
        duration_seconds: payload.duration_seconds,
      })
      webhookReceivedCounter.add(1, {
        signature_valid: 'true',
        status: payload.status,
      })

      try {
        // Fan-out: BullMQ workers sharing a queue name compete, so publish
        // to two topics (classify + sentiment) for parallel processing.
        await Promise.all([
          getClassifyCallQueue().add('classify', {
            call_id: payload.call_id,
            carrier_mc: payload.carrier_mc,
            load_id: payload.load_id,
            transcript: payload.transcript,
            duration_seconds: payload.duration_seconds,
            started_at: payload.started_at,
            ended_at: payload.ended_at,
            status: payload.status,
            extracted_data: payload.extracted_data,
          }),
          getAnalyzeSentimentQueue().add('sentiment', {
            call_id: payload.call_id,
            transcript: payload.transcript,
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
