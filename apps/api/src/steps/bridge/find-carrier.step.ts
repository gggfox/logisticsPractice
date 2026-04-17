import { CarrierVerificationResponseSchema } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { carrierVerificationCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { verifyCarrier } from '../../services/fmcsa.service.js'

export const config = {
  name: 'FindCarrier',
  description: 'Verify a carrier by MC number via FMCSA',
  triggers: [
    api('GET', '/api/v1/carriers/:mc_number', {
      responseSchema: { 200: asStepSchema(CarrierVerificationResponseSchema) },
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  enqueues: ['carrier.verified'],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  const { mc_number } = req.pathParams as { mc_number: string }
  enrichWideEvent(ctx, { mc_number })

  try {
    const result = await verifyCarrier(mc_number)

    enrichWideEvent(ctx, {
      eligible: result.is_eligible,
      legal_name: result.legal_name,
      operating_status: result.operating_status,
      reason: result.reason,
      enqueued_enrichment: result.is_eligible,
    })
    carrierVerificationCounter.add(1, { eligible: String(result.is_eligible) })

    if (result.is_eligible) {
      await ctx.enqueue({
        topic: 'carrier.verified',
        data: {
          mc_number: result.mc_number,
          legal_name: result.legal_name,
        },
      })
    }

    return { status: 200, body: result }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'fmcsa_lookup' })
    ctx.logger.error('Failed to verify carrier', { mc_number, error })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to verify carrier',
        statusCode: 500,
      },
    }
  }
}
