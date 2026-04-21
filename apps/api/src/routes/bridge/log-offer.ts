import {
  MAX_NEGOTIATION_ROUNDS,
  OFFER_ACCEPT_MARGIN_PERCENT,
  OfferRequestSchema,
  OfferResponseSchema,
} from '@carrier-sales/shared'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../config.js'
import { bookingOutcomeCounter, negotiationRoundsHistogram } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'
import { ErrorBodySchema } from '../_error-schema.js'
import { HR_SESSION_HEADER, resolveCallId } from './_call-id.js'

export function calculateCounterOffer(
  loadboardRate: number,
  offeredRate: number,
  round: number,
): number {
  const gap = loadboardRate - offeredRate
  const concessionFactor = 0.3 + round * 0.15
  return Math.round(loadboardRate - gap * concessionFactor)
}

/**
 * Read the call_id off the request, preferring the HR session header,
 * enrich the wide event with the diagnostic flags, and apply the
 * `STRICT_CALL_ID` policy. Returns `{ kind: 'resolved', call_id }` to
 * continue processing or `{ kind: 'replied' }` when a 422 has already
 * been sent. Extracted from the route handler so the latter stays under
 * the Biome cognitive-complexity budget.
 */
function resolveCallIdOrReply(
  req: FastifyRequest,
  reply: FastifyReply,
  body: { call_id: string; load_id: string; carrier_mc: string },
): { kind: 'resolved'; call_id: string } | { kind: 'replied' } {
  const { call_id: bodyCallId, load_id, carrier_mc } = body
  const headerValue = req.headers[HR_SESSION_HEADER]
  const resolved = resolveCallId(headerValue, bodyCallId)

  enrichWideEvent(req, {
    call_id_source: resolved.source,
    call_id_is_template_literal: resolved.body_is_template,
    call_id_looks_like_convex_id: resolved.body_is_convex_id,
  })

  if (resolved.call_id !== null) {
    return { kind: 'resolved', call_id: resolved.call_id }
  }

  enrichWideEvent(req, { failure_stage: 'call_id_unresolvable' })

  if (config.bridge.strictCallId) {
    req.log.warn(
      { body_call_id: bodyCallId, load_id, carrier_mc, header_present: Boolean(headerValue) },
      `call_id unresolvable: body is template/Convex-id and ${HR_SESSION_HEADER} header is missing.`,
    )
    reply.code(422).send({
      error: 'Unprocessable Entity',
      message: `Cannot correlate this offer to a call. Set the \`${HR_SESSION_HEADER}\` header to \`@session_id\` in the HappyRobot POST Webhook node, or send a resolved session UUID as the body \`call_id\`.`,
      statusCode: 422,
    })
    return { kind: 'replied' }
  }

  // Flag-off fallback: keep processing on the least-bad input so an
  // in-flight call doesn't hang mid-negotiation. The wide-event flags
  // above are the SigNoz-queryable signal that HR is still
  // misconfigured.
  req.log.warn(
    { body_call_id: bodyCallId, load_id, carrier_mc },
    `call_id unresolvable; falling back to body value in non-strict mode. Set ${HR_SESSION_HEADER} and flip STRICT_CALL_ID=true to enforce.`,
  )
  return { kind: 'resolved', call_id: bodyCallId }
}

const logOfferRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/offers',
    {
      schema: {
        tags: ['offers'],
        summary: 'Submit a carrier offer (negotiation round)',
        description: `Evaluates a carrier's offer for a load. Returns either an acceptance or a counter, advancing the negotiation round stored in Convex by call_id. Round > ${MAX_NEGOTIATION_ROUNDS} short-circuits with \`max_rounds_reached\`. The \`call_id\` is preferably read from the \`X-Happyrobot-Session-Id\` request header (HR templates headers server-side); falling back to body \`call_id\` only when it is not raw template text and not a Convex document id. When \`STRICT_CALL_ID=true\`, unresolvable correlation ids return 422.`,
        body: OfferRequestSchema,
        response: {
          200: OfferResponseSchema,
          404: ErrorBodySchema,
          422: ErrorBodySchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const { call_id: bodyCallId, load_id, carrier_mc, offered_rate } = req.body
      enrichWideEvent(req, { load_id, carrier_mc, offered_rate })

      const resolution = resolveCallIdOrReply(req, reply, {
        call_id: bodyCallId,
        load_id,
        carrier_mc,
      })
      if (resolution.kind === 'replied') {
        return reply
      }
      const call_id = resolution.call_id
      enrichWideEvent(req, { call_id })

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

        const currentRound = await convexService.negotiations.getCurrentRound(call_id)
        const round = currentRound + 1
        enrichWideEvent(req, {
          round,
          loadboard_rate: load.loadboard_rate,
          max_rounds_reached: round > MAX_NEGOTIATION_ROUNDS,
        })

        if (round > MAX_NEGOTIATION_ROUNDS) {
          bookingOutcomeCounter.add(1, { result: 'max_rounds' })
          negotiationRoundsHistogram.record(MAX_NEGOTIATION_ROUNDS, {
            outcome: 'max_rounds',
          })
          return {
            accepted: false,
            round: MAX_NEGOTIATION_ROUNDS,
            max_rounds_reached: true,
            message: 'Maximum negotiation rounds reached. We cannot go lower on this load.',
          }
        }

        const minAcceptableRate = load.loadboard_rate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100)
        const accepted = offered_rate >= minAcceptableRate

        let counterOffer: number | undefined
        let message: string

        if (accepted) {
          message = `Offer of $${offered_rate} accepted for load ${load_id}.`
          await convexService.loads.updateStatus(load_id, 'booked')
          bookingOutcomeCounter.add(1, {
            result: 'accepted',
            round: String(round),
          })
          negotiationRoundsHistogram.record(round, { outcome: 'accepted' })
        } else {
          counterOffer = calculateCounterOffer(load.loadboard_rate, offered_rate, round)
          message =
            round === MAX_NEGOTIATION_ROUNDS
              ? `Our final offer is $${counterOffer}. This is the best we can do for this lane.`
              : `We can do $${counterOffer} for this load. The posted rate is $${load.loadboard_rate}.`
          bookingOutcomeCounter.add(1, {
            result: 'countered',
            round: String(round),
          })
        }

        const now = new Date().toISOString()
        await convexService.negotiations.logRound({
          call_id,
          round,
          offered_rate,
          counter_rate: counterOffer,
          accepted,
          timestamp: now,
        })

        // Seed / patch the `calls` row from the authoritative offer
        // data. HappyRobot's `session.status_changed` webhook does not
        // carry carrier/load/rate, so if we relied on it alone the
        // dashboard would show `unknown` until the `completed` event
        // arrived -- and even then without a final rate. Writing here
        // keeps Call History in sync mid-negotiation.
        await convexService.calls.upsertFromOffer({
          call_id,
          carrier_mc,
          load_id,
          negotiation_rounds: round,
          ...(accepted ? { final_rate: offered_rate, outcome: 'booked' } : {}),
          started_at: now,
        })

        enrichWideEvent(req, {
          accepted,
          counter_rate: counterOffer,
          discount_percent: ((load.loadboard_rate - offered_rate) / load.loadboard_rate) * 100,
        })

        return {
          accepted,
          counter_offer: counterOffer,
          round,
          max_rounds_reached: round >= MAX_NEGOTIATION_ROUNDS,
          message,
        }
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
