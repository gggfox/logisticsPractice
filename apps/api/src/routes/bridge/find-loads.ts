import { LoadSearchParamsSchema } from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { loadSearchResultsHistogram } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

// Response schema intentionally omitted from the `response` map: the
// Convex-generated `Load` shape widens `equipment_type` to `string`, so
// letting fastify-type-provider-zod narrow the handler return type to the
// Zod enum breaks typecheck without a cast. The Zod schema is still the
// external contract; we validate produce-side in packages/shared tests.

const findLoadsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/loads',
    {
      schema: {
        tags: ['loads'],
        summary: 'Search available loads',
        description:
          'Searches Convex for available loads. All query parameters are optional filters. Response omits the `loads[]` schema because Convex widens `equipment_type`; the canonical contract lives in `@carrier-sales/shared`.',
        querystring: LoadSearchParamsSchema,
      },
    },
    async (req, reply) => {
      const params = req.query
      enrichWideEvent(req, {
        origin: params.origin,
        destination: params.destination,
        equipment_type: params.equipment_type,
        pickup_date: params.pickup_date,
      })

      try {
        const loads = await convexService.loads.search({
          origin: params.origin,
          destination: params.destination,
          equipment_type: params.equipment_type,
        })

        loadSearchResultsHistogram.record(loads.length, {
          has_origin: String(Boolean(params.origin)),
          has_destination: String(Boolean(params.destination)),
          equipment_type: params.equipment_type ?? 'any',
        })
        enrichWideEvent(req, { result_count: loads.length })

        return { loads, total: loads.length }
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'convex_search' })
        req.log.error({ err }, 'Failed to search loads')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to search loads',
          statusCode: 500,
        })
      }
    },
  )
}

export default findLoadsRoute
