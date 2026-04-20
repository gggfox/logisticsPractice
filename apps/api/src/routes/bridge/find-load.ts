import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'
import { isUnresolvedTemplate } from './_call-id.js'

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
        tags: ['loads'],
        summary: 'Get a load by load_id',
        description:
          'Returns a single load record from Convex. Response schema is not enforced here because Convex widens `equipment_type` to a string; the authoritative contract lives in `@carrier-sales/shared`.',
        params: ParamsSchema,
      },
    },
    async (req, reply) => {
      const { load_id } = req.params
      enrichWideEvent(req, { load_id })

      // Defensive short-circuit: an upstream caller (e.g. HappyRobot) that
      // ships a literal `@reference_number` / `{{load_id}}` / `:load_id`
      // template string has a configuration bug, not a missing row. A 400
      // surfaces that bug immediately instead of masquerading as a 404 --
      // an ops hint on the wide event points at what to fix.
      if (isUnresolvedTemplate(load_id)) {
        enrichWideEvent(req, {
          template_unresolved: true,
          failure_stage: 'template_substitution',
        })
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Load id "${load_id}" looks like an unsubstituted template variable. The caller likely sent the template text instead of a resolved value.`,
          statusCode: 400,
        })
      }

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

        // Strip Convex-internal fields (`_id`, `_creationTime`) from the
        // public response. An upstream workflow that templates `call_id`
        // from this response's `_id` would silently collide with real
        // HappyRobot session ids in the `calls` table; removing the field
        // here means there is nothing for the workflow to accidentally
        // grab. The canonical shape lives in `LoadSchema` and does not
        // include these system fields.
        const { _id, _creationTime, ...publicLoad } = load
        return publicLoad
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
