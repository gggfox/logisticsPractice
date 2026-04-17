import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

const ParamsSchema = z.object({
  load_id: z.string().min(1),
})

// Response schema intentionally omitted: Convex returns `equipment_type` as
// `string`, but LoadSchema narrows to an enum. The public contract lives in
// packages/shared; here we keep the handler untyped on the response side.

const findLoadRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/loads/:load_id',
    {
      schema: {
        params: ParamsSchema,
      },
    },
    async (req, reply) => {
      const { load_id } = req.params
      enrichWideEvent(req, { load_id })

      try {
        const load = await convexService.loads.getByLoadId(load_id)
        enrichWideEvent(req, { found: load != null })

        if (!load) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `Load ${load_id} not found`,
            statusCode: 404,
          })
        }

        enrichWideEvent(req, {
          load_status: load.status,
          loadboard_rate: load.loadboard_rate,
          origin: load.origin,
          destination: load.destination,
          equipment_type: load.equipment_type,
        })

        return load
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'convex_lookup' })
        req.log.error({ err, load_id }, 'Failed to fetch load')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch load',
          statusCode: 500,
        })
      }
    },
  )
}

export default findLoadRoute
