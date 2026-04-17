import { LoadSchema } from '@carrier-sales/shared'
import { http, type Handlers, type StepConfig } from 'motia'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'FindLoad',
  description: 'Get a single load by ID',
  triggers: [
    http('GET', '/api/v1/loads/:load_id', {
      responseSchema: { 200: LoadSchema },
      middleware: [rateLimiter, apiKeyAuth],
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger }) {
    try {
      const { load_id } = req.params as { load_id: string }
      logger.info('Fetching load', { load_id })

      const load = await convexService.loads.getByLoadId(load_id)

      if (!load) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Load ${load_id} not found`,
          statusCode: 404,
        })
      }

      return res.status(200).json(load)
    } catch (error) {
      logger.error('Failed to fetch load', { error })
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch load',
        statusCode: 500,
      })
    }
  },
}
