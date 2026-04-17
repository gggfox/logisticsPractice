import { CarrierVerificationResponseSchema } from '@carrier-sales/shared'
import { http, type Handlers, type StepConfig } from 'motia'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { verifyCarrier } from '../../services/fmcsa.service.js'

export const config = {
  name: 'FindCarrier',
  description: 'Verify a carrier by MC number via FMCSA',
  triggers: [
    http('GET', '/api/v1/carriers/:mc_number', {
      responseSchema: { 200: CarrierVerificationResponseSchema },
      middleware: [rateLimiter, apiKeyAuth],
    }),
  ],
  enqueues: ['carrier.verified'],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger, enqueue }) {
    try {
      const { mc_number } = req.params as { mc_number: string }
      logger.info('Verifying carrier', { mc_number })

      const result = await verifyCarrier(mc_number)

      if (result.is_eligible) {
        await enqueue('carrier.verified', {
          mc_number: result.mc_number,
          legal_name: result.legal_name,
        })
      }

      logger.info('Carrier verification complete', {
        mc_number,
        eligible: result.is_eligible,
      })

      return res.status(200).json(result)
    } catch (error) {
      logger.error('Failed to verify carrier', { error })
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify carrier',
        statusCode: 500,
      })
    }
  },
}
