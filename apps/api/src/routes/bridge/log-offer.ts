import {
  MAX_NEGOTIATION_ROUNDS,
  OFFER_ACCEPT_MARGIN_PERCENT,
  OfferRequestSchema,
  OfferResponseSchema,
} from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { bookingOutcomeCounter, negotiationRoundsHistogram } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'
import { ErrorBodySchema } from '../_error-schema.js'

export function calculateCounterOffer(
  loadboardRate: number,
  offeredRate: number,
  round: number,
): number {
  const gap = loadboardRate - offeredRate
  const concessionFactor = 0.3 + round * 0.15
  return Math.round(loadboardRate - gap * concessionFactor)
}

const logOfferRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/offers',
    {
      schema: {
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

        await convexService.negotiations.logRound({
          call_id,
          round,
          offered_rate,
          counter_rate: counterOffer,
          accepted,
          timestamp: new Date().toISOString(),
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
