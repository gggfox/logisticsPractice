import { LoadResponseSchema, LoadSearchParamsSchema } from '@carrier-sales/shared'
import { http, type Handlers, type StepConfig } from 'motia'
import { z } from 'zod'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'FindLoads',
  description: 'Search available loads by origin, destination, equipment type',
  triggers: [
    http('GET', '/api/v1/loads', {
      queryParams: [
        { name: 'origin', description: 'Origin city/state' },
        { name: 'destination', description: 'Destination city/state' },
        { name: 'equipment_type', description: 'Equipment type filter' },
        { name: 'pickup_date', description: 'Pickup date filter (YYYY-MM-DD)' },
      ],
      responseSchema: {
        200: LoadResponseSchema,
      },
      middleware: [rateLimiter, apiKeyAuth],
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger }) {
    try {
      const params = LoadSearchParamsSchema.safeParse(req.query)
      if (!params.success) {
        return res.status(400).json({
          error: 'Bad Request',
          message: params.error.message,
          statusCode: 400,
        })
      }

      logger.info('Searching loads', { params: params.data })

      const loads = await convexService.loads.search({
        origin: params.data.origin,
        destination: params.data.destination,
        equipment_type: params.data.equipment_type,
      })

      return res.status(200).json({ loads, total: loads.length })
    } catch (error) {
      logger.error('Failed to search loads', { error })
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to search loads',
        statusCode: 500,
      })
    }
  },
}
