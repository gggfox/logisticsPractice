import { LoadSchema } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { asStepSchema } from '../../lib/zod-schema.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { rateLimiter } from '../../middleware/rate-limiter.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'FindLoad',
  description: 'Get a single load by ID',
  triggers: [
    api('GET', '/api/v1/loads/:load_id', {
      responseSchema: { 200: asStepSchema(LoadSchema) },
      middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware],
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  const { load_id } = req.pathParams as { load_id: string }
  enrichWideEvent(ctx, { load_id })

  try {
    const load = await convexService.loads.getByLoadId(load_id)
    enrichWideEvent(ctx, { found: load != null })

    if (!load) {
      return {
        status: 404,
        body: {
          error: 'Not Found',
          message: `Load ${load_id} not found`,
          statusCode: 404,
        },
      }
    }

    enrichWideEvent(ctx, {
      load_status: load.status,
      loadboard_rate: load.loadboard_rate,
      origin: load.origin,
      destination: load.destination,
      equipment_type: load.equipment_type,
    })

    return { status: 200, body: load }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'convex_lookup' })
    ctx.logger.error('Failed to fetch load', { load_id, error })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to fetch load',
        statusCode: 500,
      },
    }
  }
}
