import { LoadResponseSchema, LoadSearchParamsSchema } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { loadSearchResultsHistogram } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'FindLoads',
  description: 'Search available loads by origin, destination, equipment type',
  triggers: [
    api('GET', '/api/v1/loads', {
      queryParams: [
        { name: 'origin', description: 'Origin city/state' },
        { name: 'destination', description: 'Destination city/state' },
        { name: 'equipment_type', description: 'Equipment type filter' },
        { name: 'pickup_date', description: 'Pickup date filter (YYYY-MM-DD)' },
      ],
      responseSchema: {
        200: asStepSchema(LoadResponseSchema),
      },
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  try {
    const params = LoadSearchParamsSchema.safeParse(req.queryParams)
    if (!params.success) {
      enrichWideEvent(ctx, { validation_error: params.error.message })
      return {
        status: 400,
        body: {
          error: 'Bad Request',
          message: params.error.message,
          statusCode: 400,
        },
      }
    }

    enrichWideEvent(ctx, {
      origin: params.data.origin,
      destination: params.data.destination,
      equipment_type: params.data.equipment_type,
      pickup_date: params.data.pickup_date,
    })

    const loads = await convexService.loads.search({
      origin: params.data.origin,
      destination: params.data.destination,
      equipment_type: params.data.equipment_type,
    })

    loadSearchResultsHistogram.record(loads.length, {
      has_origin: String(Boolean(params.data.origin)),
      has_destination: String(Boolean(params.data.destination)),
      equipment_type: params.data.equipment_type ?? 'any',
    })
    enrichWideEvent(ctx, { result_count: loads.length })

    return { status: 200, body: { loads, total: loads.length } }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'convex_search' })
    ctx.logger.error('Failed to search loads', { error })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to search loads',
        statusCode: 500,
      },
    }
  }
}
