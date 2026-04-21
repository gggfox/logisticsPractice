import { CallWebhookPayloadSchema } from '@carrier-sales/shared'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { webhookReceivedCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { verifyWebhookSignature } from '../../plugins/hmac.js'
import { getAnalyzeSentimentQueue, getClassifyCallQueue } from '../../queues/index.js'
import { ErrorBodySchema } from '../_error-schema.js'
import {
  type SpeakerTurn,
  extractSpeakersFromPayload,
  isTerminalStatus,
  resolveTranscript,
  unwrapCloudEventPayload,
} from './normalize-call-payload.js'
import {
  extractBookingDecision,
  extractFinalRate,
  extractReferenceNumber,
  isPlausibleLoadId,
  isValidMcFormat,
} from './validation.js'

const WebhookAckSchema = z.object({ received: z.literal(true) })

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

/**
 * Like `pickString`, but also accepts a finite positive number and coerces
 * it to its decimal string. HappyRobot's templated Webhook body resolves
 * numeric agent variables (`@mc_number`, sometimes `@load_id`) into raw
 * JSON numbers, not strings:
 *
 *   { "mc_number": 264184 }   // not "264184"
 *
 * `carrier_mc` downstream is a `string`, so we coerce at the boundary.
 * Non-positive / non-finite numbers (`0`, `-1`, `NaN`) are rejected so a
 * miswired template can't smuggle a junk id through.
 */
function pickIdString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v)
  }
  return undefined
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

interface NormalizedCallEvent {
  call_id: string
  status: string
  carrier_mc: string | undefined
  load_id: string | undefined
  duration_seconds: number | undefined
  phone_number: string | undefined
  started_at: string
  ended_at: string | undefined
  extracted_data: Record<string, unknown> | undefined
  booking_decision: 'yes' | 'no' | undefined
  final_rate_from_extraction: number | undefined
  classification_tag: string | undefined
  carrier_mc_valid: boolean
  load_id_plausible: boolean
  is_terminal: boolean
  transcript: string
  speakers: SpeakerTurn[] | undefined
  envelope: ReturnType<typeof unwrapCloudEventPayload>
  vars: Record<string, unknown>
  raw: Record<string, unknown>
}

/**
 * HR's AI Classify node output lands in the webhook body in one of
 * three templates we've seen:
 *   - `classification.tag: "Success"` (§9.1 nested shape from the docs)
 *   - `classification_tag: "Success"` (flat alias some workflows use)
 *   - `classification: "Success"` (raw string on flat templates)
 * Empty strings are treated as absent so a templated webhook whose
 * source variable never resolved doesn't smuggle `""` into downstream
 * outcome resolution.
 */
function extractClassificationTag(inner: Record<string, unknown>): string | undefined {
  const classification = inner.classification
  if (typeof classification === 'string' && classification.trim().length > 0) {
    return classification.trim()
  }
  if (classification && typeof classification === 'object' && !Array.isArray(classification)) {
    const tag = (classification as Record<string, unknown>).tag
    if (typeof tag === 'string' && tag.trim().length > 0) return tag.trim()
  }
  const flat = inner.classification_tag
  if (typeof flat === 'string' && flat.trim().length > 0) return flat.trim()
  return undefined
}

/**
 * Collapse both shapes HR can ship -- the native CloudEvents envelope and
 * the templated per-node Webhook body -- into one canonical structure the
 * handler branches on. Pure so the handler stays under the biome cognitive
 * complexity cap.
 *
 * `carrier_mc` / `load_id` are searched at three nesting levels:
 *   1. Top-level (the templated Webhook fired after `AI Extract`).
 *   2. `variables.*` (older HR workflows surfacing tool params as vars).
 *   3. `extracted_data.*` (AI Extract response under `mc_number` /
 *      `reference_number`).
 */
export function normalizeCallEvent(raw: Record<string, unknown>): NormalizedCallEvent {
  const envelope = unwrapCloudEventPayload(raw)
  const inner = envelope.inner
  const vars = (inner.variables ?? {}) as Record<string, unknown>
  const speakers = extractSpeakersFromPayload(inner)
  const transcript = resolveTranscript(inner, speakers)

  // `negotiate_offer` in HappyRobot templates `call_id: @session_id`, so
  // the call_id we care about is ALWAYS the HR session UUID. It can
  // arrive as:
  //   - `envelope.session_id` on a CloudEvents `session.status_changed`
  //     delivery (the native workflow-level webhook).
  //   - `inner.call_id` on the flat templated per-node webhook (HR
  //     resolves `@session_id` into the body's `call_id` field).
  //
  // `envelope.run_id` is the RUN uuid, NOT the session uuid -- using it
  // as the call_id would break correlation with negotiation rows, which
  // are keyed on session_id. So it only serves as a last-resort fallback
  // after body-level overrides. `'unknown'` is the sentinel for "no
  // correlation id at all" and is caught by the route.
  const call_id =
    envelope.session_id ??
    pickString(inner.call_id, vars.session_id, vars.call_id) ??
    envelope.run_id ??
    'unknown'
  const status = envelope.status_current ?? pickString(inner.status) ?? 'completed'
  const extracted_data =
    (inner.extracted_data as Record<string, unknown> | undefined) ??
    (inner.extraction as Record<string, unknown> | undefined)

  // `inner.mc_number` covers the current HR templated webhook body, which
  // ships the MC at the top level as `mc_number` (not `carrier_mc`) and
  // often as a raw JSON number because `@mc_number` in HR agent state is
  // numeric. Without it, every prod call lands with `carrier_mc: "unknown"`
  // and drops out of the booking gate -- see docs/happyrobot-setup.md §9.1.
  const carrier_mc = pickIdString(
    inner.carrier_mc,
    inner.mc_number,
    vars.carrier_mc,
    vars.mc_number,
    extracted_data?.carrier_mc,
    extracted_data?.mc_number,
  )
  // `inner.reference_number` covers flat templated bodies that lift the
  // Extract node's `reference_number` up to the top level instead of
  // nesting it inside `extracted_data`.
  const load_id = pickIdString(
    inner.load_id,
    vars.load_id,
    vars.reference_number,
    extractReferenceNumber(extracted_data),
    extractReferenceNumber(inner),
  )
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

  return {
    call_id,
    status,
    carrier_mc,
    load_id,
    duration_seconds,
    phone_number,
    started_at,
    ended_at,
    extracted_data,
    // Accept booking_decision / final_rate at the top level too so flat
    // HR templates that don't nest under `extracted_data` can still drive
    // the booking gate. Nested extraction wins when both are present.
    booking_decision: extractBookingDecision(extracted_data) ?? extractBookingDecision(inner),
    final_rate_from_extraction: extractFinalRate(extracted_data) ?? extractFinalRate(inner),
    classification_tag: extractClassificationTag(inner),
    carrier_mc_valid: carrier_mc === undefined || isValidMcFormat(carrier_mc),
    load_id_plausible: load_id === undefined || isPlausibleLoadId(load_id),
    is_terminal: isTerminalStatus(envelope.status_current),
    transcript,
    speakers,
    envelope,
    vars,
    raw,
  }
}

function resolveSignatureState(req: FastifyRequest): 'valid' | 'invalid' | 'absent' {
  const hasSignature = typeof req.headers['x-webhook-signature'] === 'string'
  if (!hasSignature) return 'absent'
  return verifyWebhookSignature(req) ? 'valid' : 'invalid'
}

function enrichWebhookEvent(
  req: FastifyRequest,
  n: NormalizedCallEvent,
  signatureState: 'valid' | 'invalid' | 'absent',
): void {
  enrichWideEvent(req, {
    signature_state: signatureState,
    call_id: n.call_id,
    call_status: n.status,
    cloudevent: n.envelope.is_cloud_event,
    cloudevent_type: n.envelope.cloudevent_type,
    status_current: n.envelope.status_current,
    status_previous: n.envelope.status_previous,
    is_terminal: n.is_terminal,
    has_transcript: n.transcript.length > 0,
    speaker_turns: n.speakers?.length ?? 0,
    carrier_mc: n.carrier_mc,
    load_id: n.load_id,
    duration_seconds: n.duration_seconds,
    phone_present: Boolean(n.phone_number),
    payload_keys: Object.keys(n.raw)
      .sort((a, b) => a.localeCompare(b))
      .join(','),
    data_keys: n.envelope.is_cloud_event
      ? Object.keys(n.envelope.inner)
          .sort((a, b) => a.localeCompare(b))
          .join(',')
      : undefined,
    vars_keys:
      Object.keys(n.vars)
        .sort((a, b) => a.localeCompare(b))
        .join(',') || undefined,
    has_extracted_data: n.extracted_data !== undefined,
    booking_decision: n.booking_decision,
    final_rate_from_extraction: n.final_rate_from_extraction,
    classification_tag: n.classification_tag,
    carrier_mc_valid: n.carrier_mc_valid,
    load_id_plausible: n.load_id_plausible,
  })
}

async function enqueueClassifyJobs(n: NormalizedCallEvent): Promise<void> {
  // Fan-out: BullMQ workers sharing a queue name compete, so publish
  // to two topics (classify + sentiment) for parallel processing. The
  // classify job is delayed 3s so the first attempt doesn't race
  // HappyRobot's Extract node -- HR's extraction lands in the
  // `calls/:id` run view a beat after `status_changed: completed`
  // fires, and starting without the extraction forces every call
  // through at least one retry. Sentiment runs immediately because it
  // works off the webhook transcript alone.
  await Promise.all([
    getClassifyCallQueue().add(
      'classify',
      {
        call_id: n.call_id,
        run_id: n.envelope.run_id,
        // Format-guard carrier/load at the queue boundary: downstream
        // `markBooked` relies on the invariant that carrier_mc looks
        // like an MC and load_id isn't a raw HR template.
        carrier_mc: n.carrier_mc_valid ? n.carrier_mc : undefined,
        load_id: n.load_id_plausible ? n.load_id : undefined,
        transcript: n.transcript,
        speakers: n.speakers,
        duration_seconds: n.duration_seconds,
        started_at: n.started_at,
        ended_at: n.ended_at ?? n.started_at,
        status: n.status,
        extracted_data: n.extracted_data,
        booking_decision: n.booking_decision,
        final_rate_from_extraction: n.final_rate_from_extraction,
        classification_tag: n.classification_tag,
      },
      { delay: 3_000 },
    ),
    getAnalyzeSentimentQueue().add('sentiment', {
      call_id: n.call_id,
      run_id: n.envelope.run_id,
      transcript: n.transcript,
    }),
  ])
}

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
      const signatureState = resolveSignatureState(req)

      // HappyRobot posts a CloudEvents 1.0 envelope whose real payload
      // is under `data` (see normalize-call-payload.ts). The templated
      // per-node webhook ships a flat body. `normalizeCallEvent` handles
      // both shapes.
      const normalized = normalizeCallEvent(req.body as Record<string, unknown>)
      enrichWebhookEvent(req, normalized, signatureState)
      webhookReceivedCounter.add(1, {
        signature_state: signatureState,
        status: normalized.status,
      })

      // `session.status_changed` fires on every transition
      // (`queued` -> `in-progress` -> `completed`). Only terminal
      // statuses should advance the downstream pipeline; acking 200 on
      // the rest avoids creating a stream of partial `calls` rows and
      // tells HappyRobot the delivery succeeded.
      if (!normalized.is_terminal) {
        enrichWideEvent(req, { enqueued: false, skip_reason: 'non_terminal_status' })
        return { received: true as const }
      }

      // Without a correlation id we cannot backfill from HR or join
      // this webhook against prior offer rows -- the resulting calls
      // row would be pure noise. Ack 200 so HR doesn't retry, but skip
      // the Convex write.
      if (normalized.call_id === 'unknown') {
        enrichWideEvent(req, { enqueued: false, skip_reason: 'no_correlation_id' })
        return { received: true as const }
      }

      try {
        await enqueueClassifyJobs(normalized)
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
