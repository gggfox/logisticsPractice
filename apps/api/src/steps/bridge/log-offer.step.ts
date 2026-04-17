import {
  MAX_NEGOTIATION_ROUNDS,
  OFFER_ACCEPT_MARGIN_PERCENT,
  OfferRequestSchema,
  OfferResponseSchema,
} from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { bookingOutcomeCounter, negotiationRoundsHistogram } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'LogOffer',
  description: 'Log a negotiation offer and evaluate acceptance',
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

function calculateCounterOffer(loadboardRate: number, offeredRate: number, round: number): number {
  const gap = loadboardRate - offeredRate
  const concessionFactor = 0.3 + round * 0.15
  return Math.round(loadboardRate - gap * concessionFactor)
}

export const handler: Handlers<typeof config> = async (req, ctx) => {
  try {
    const parsed = OfferRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      enrichWideEvent(ctx, { validation_error: parsed.error.message })
      return {
        status: 400,
        body: {
          error: 'Bad Request',
          message: parsed.error.message,
          statusCode: 400,
        },
      }
    }

    const { call_id, load_id, carrier_mc, offered_rate } = parsed.data
    enrichWideEvent(ctx, { call_id, load_id, carrier_mc, offered_rate })

    const load = await convexService.loads.getByLoadId(load_id)
    if (!load) {
      enrichWideEvent(ctx, { failure_stage: 'load_not_found' })
      return {
        status: 404,
        body: {
          error: 'Not Found',
          message: `Load ${load_id} not found`,
          statusCode: 404,
        },
      }
    }

    const currentRound = await convexService.negotiations.getCurrentRound(call_id)
    const round = currentRound + 1
    enrichWideEvent(ctx, {
      round,
      loadboard_rate: load.loadboard_rate,
      max_rounds_reached: round > MAX_NEGOTIATION_ROUNDS,
    })

    if (round > MAX_NEGOTIATION_ROUNDS) {
      bookingOutcomeCounter.add(1, { result: 'max_rounds' })
      negotiationRoundsHistogram.record(MAX_NEGOTIATION_ROUNDS, { outcome: 'max_rounds' })
      return {
        status: 200,
        body: {
          accepted: false,
          round: MAX_NEGOTIATION_ROUNDS,
          max_rounds_reached: true,
          message: 'Maximum negotiation rounds reached. We cannot go lower on this load.',
        },
      }
    }

    const minAcceptableRate = load.loadboard_rate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100)
    const accepted = offered_rate >= minAcceptableRate

    let counterOffer: number | undefined
    let message: string

    if (accepted) {
      message = `Offer of $${offered_rate} accepted for load ${load_id}.`
      await convexService.loads.updateStatus(load_id, 'booked')
      bookingOutcomeCounter.add(1, { result: 'accepted', round: String(round) })
      negotiationRoundsHistogram.record(round, { outcome: 'accepted' })
    } else {
      counterOffer = calculateCounterOffer(load.loadboard_rate, offered_rate, round)
      message =
        round === MAX_NEGOTIATION_ROUNDS
          ? `Our final offer is $${counterOffer}. This is the best we can do for this lane.`
          : `We can do $${counterOffer} for this load. The posted rate is $${load.loadboard_rate}.`
      bookingOutcomeCounter.add(1, { result: 'countered', round: String(round) })
    }

    await convexService.negotiations.logRound({
      call_id,
      round,
      offered_rate,
      counter_rate: counterOffer,
      accepted,
      timestamp: new Date().toISOString(),
    })

    await ctx.enqueue({
      topic: 'negotiation.logged',
      data: {
        call_id,
        load_id,
        carrier_mc,
        round,
        accepted,
        offered_rate,
        counter_rate: counterOffer,
      },
    })

    enrichWideEvent(ctx, {
      accepted,
      counter_rate: counterOffer,
      discount_percent: ((load.loadboard_rate - offered_rate) / load.loadboard_rate) * 100,
    })

    return {
      status: 200,
      body: {
        accepted,
        counter_offer: counterOffer,
        round,
        max_rounds_reached: round >= MAX_NEGOTIATION_ROUNDS,
        message,
      },
    }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'offer_processing' })
    ctx.logger.error('Failed to process offer', { error })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to process offer',
        statusCode: 500,
      },
    }
  }
}
