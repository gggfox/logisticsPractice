import { CallWebhookPayloadSchema } from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { webhookReceivedCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { verifyWebhookSignature } from '../../plugins/hmac.js'
import { getAnalyzeSentimentQueue, getClassifyCallQueue } from '../../queues/index.js'
import { ErrorBodySchema } from '../_error-schema.js'
import {
  extractSpeakersFromPayload,
  isTerminalStatus,
  resolveTranscript,
  unwrapCloudEventPayload,
} from './normalize-call-payload.js'

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

      // HappyRobot posts a CloudEvents 1.0 envelope whose real payload
      // is under `data` (see normalize-call-payload.ts). Unwrap first
      // so the rest of the pipeline sees a single canonical shape.
      const raw = req.body as Record<string, unknown>
      const envelope = unwrapCloudEventPayload(raw)
      const inner = envelope.inner
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
      const vars = (inner.variables ?? {}) as Record<string, unknown>
      const speakers = extractSpeakersFromPayload(inner)
      const transcript = resolveTranscript(inner, speakers)

      // `negotiate_offer` in HappyRobot templates `call_id: @session_id`,
      // so prefer the envelope's `session_id` to correlate the webhook
      // with the offer rows already written to Convex.
      const call_id =
        envelope.session_id ??
        envelope.run_id ??
        pickString(inner.call_id, vars.session_id, vars.call_id) ??
        'unknown'
      const status = envelope.status_current ?? pickString(inner.status) ?? 'completed'
      const carrier_mc = pickString(inner.carrier_mc, vars.carrier_mc, vars.mc_number)
      const load_id = pickString(inner.load_id, vars.load_id, vars.reference_number)
      const duration_seconds = pickNumber(inner.duration_seconds)
      const phone_number = pickString(inner.phone_number, vars.phone_number)
      // Convex requires `started_at: string`; fall back to the status
      // transition time, then the envelope emission time, then now.
      const started_at =
        pickString(inner.started_at) ??
        envelope.status_updated_at ??
        envelope.event_time ??
        new Date().toISOString()
      const ended_at = pickString(inner.ended_at) ?? envelope.status_updated_at
      const extracted_data =
        (inner.extracted_data as Record<string, unknown> | undefined) ??
        (inner.extraction as Record<string, unknown> | undefined)
      const is_terminal = isTerminalStatus(envelope.status_current)

      enrichWideEvent(req, {
        call_id,
        call_status: status,
        cloudevent: envelope.is_cloud_event,
        cloudevent_type: envelope.cloudevent_type,
        status_current: envelope.status_current,
        status_previous: envelope.status_previous,
        is_terminal,
        has_transcript: transcript.length > 0,
        speaker_turns: speakers?.length ?? 0,
        carrier_mc,
        load_id,
        duration_seconds,
        phone_present: Boolean(phone_number),
        // Diagnostic: top-level keys on both the envelope and the
        // unwrapped body. Low-cardinality (sender-stable), no PII.
        payload_keys: Object.keys(raw)
          .sort((a, b) => a.localeCompare(b))
          .join(','),
        data_keys: envelope.is_cloud_event
          ? Object.keys(inner)
              .sort((a, b) => a.localeCompare(b))
              .join(',')
          : undefined,
      })
      webhookReceivedCounter.add(1, {
        signature_state: signatureState,
        status,
      })

      // `session.status_changed` fires on every transition
      // (`queued` -> `in-progress` -> `completed`). Only terminal
      // statuses should advance the downstream pipeline; acking 200
      // on the rest avoids creating a stream of partial `calls` rows
      // and tells HappyRobot the delivery succeeded.
      if (!is_terminal) {
        enrichWideEvent(req, { enqueued: false, skip_reason: 'non_terminal_status' })
        return { received: true as const }
      }

      try {
        // Fan-out: BullMQ workers sharing a queue name compete, so publish
        // to two topics (classify + sentiment) for parallel processing.
        await Promise.all([
          getClassifyCallQueue().add('classify', {
            call_id,
            carrier_mc,
            load_id,
            transcript,
            speakers,
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
