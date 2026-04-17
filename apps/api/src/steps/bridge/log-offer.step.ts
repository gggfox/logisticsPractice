import {
  MAX_NEGOTIATION_ROUNDS,
  OFFER_ACCEPT_MARGIN_PERCENT,
  OfferRequestSchema,
  OfferResponseSchema,
} from '@carrier-sales/shared'
import { http, type Handlers, type StepConfig } from 'motia'
import { z } from 'zod'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'LogOffer',
  description: 'Log a negotiation offer and evaluate acceptance',
  triggers: [
    http('POST', '/api/v1/offers', {
      bodySchema: OfferRequestSchema,
      responseSchema: { 200: OfferResponseSchema },
      middleware: [rateLimiter, apiKeyAuth],
    }),
  ],
  enqueues: ['negotiation.logged'],
  flows: ['bridge-api'],
} as const satisfies StepConfig

function calculateCounterOffer(loadboardRate: number, offeredRate: number, round: number): number {
  const gap = loadboardRate - offeredRate
  const concessionFactor = 0.3 + round * 0.15
  return Math.round(loadboardRate - gap * concessionFactor)
}

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger, enqueue }) {
    try {
      const parsed = OfferRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Bad Request',
          message: parsed.error.message,
          statusCode: 400,
        })
      }

      const { call_id, load_id, carrier_mc, offered_rate } = parsed.data
      logger.info('Processing offer', { call_id, load_id, offered_rate })

      const load = await convexService.loads.getByLoadId(load_id)
      if (!load) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Load ${load_id} not found`,
          statusCode: 404,
        })
      }

      const currentRound = await convexService.negotiations.getCurrentRound(call_id)
      const round = currentRound + 1

      if (round > MAX_NEGOTIATION_ROUNDS) {
        return res.status(200).json({
          accepted: false,
          round: MAX_NEGOTIATION_ROUNDS,
          max_rounds_reached: true,
          message: 'Maximum negotiation rounds reached. We cannot go lower on this load.',
        })
      }

      const minAcceptableRate = load.loadboard_rate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100)
      const accepted = offered_rate >= minAcceptableRate

      let counterOffer: number | undefined
      let message: string

      if (accepted) {
        message = `Offer of $${offered_rate} accepted for load ${load_id}.`
        await convexService.loads.updateStatus(load_id, 'booked')
      } else {
        counterOffer = calculateCounterOffer(load.loadboard_rate, offered_rate, round)
        message =
          round === MAX_NEGOTIATION_ROUNDS
            ? `Our final offer is $${counterOffer}. This is the best we can do for this lane.`
            : `We can do $${counterOffer} for this load. The posted rate is $${load.loadboard_rate}.`
      }

      await convexService.negotiations.logRound({
        call_id,
        round,
        offered_rate,
        counter_rate: counterOffer,
        accepted,
        timestamp: new Date().toISOString(),
      })

      await enqueue('negotiation.logged', {
        call_id,
        load_id,
        carrier_mc,
        round,
        accepted,
        offered_rate,
        counter_rate: counterOffer,
      })

      logger.info('Offer processed', { call_id, round, accepted })

      return res.status(200).json({
        accepted,
        counter_offer: counterOffer,
        round,
        max_rounds_reached: round >= MAX_NEGOTIATION_ROUNDS,
        message,
      })
    } catch (error) {
      logger.error('Failed to process offer', { error })
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to process offer',
        statusCode: 500,
      })
    }
  },
}
