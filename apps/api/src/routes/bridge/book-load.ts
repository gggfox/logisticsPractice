import {
  BookLoadRequestSchema,
  BookLoadResponseSchema,
  OFFER_ACCEPT_MARGIN_PERCENT,
} from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { bookingOutcomeCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'
import { ErrorBodySchema } from '../_error-schema.js'
import { HR_SESSION_HEADER, resolveCallId } from './_call-id.js'

const ParamsSchema = z.object({
  load_id: z.string().min(1),
})

const bookLoadRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/loads/:load_id/book',
    {
      schema: {
        tags: ['offers'],
        summary: 'Confirm a booking at an agreed rate',
        description: `Called by the HappyRobot \`book_load\` tool after the caller accepts a counter (typically right after \`negotiate_offer\` returns \`max_rounds_reached: true\`). Reads the correlation id from the \`${HR_SESSION_HEADER}\` header so the LLM can't invent it. Rejects \`agreed_rate\` that falls outside \`[loadboard_rate * (1 - ${OFFER_ACCEPT_MARGIN_PERCENT}%), loadboard_rate]\` to prevent a throwaway low-ball book.`,
        params: ParamsSchema,
        body: BookLoadRequestSchema,
        response: {
          200: BookLoadResponseSchema,
          404: ErrorBodySchema,
          409: ErrorBodySchema,
          422: ErrorBodySchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const { load_id } = req.params
      const { agreed_rate, carrier_mc } = req.body
      const headerValue = req.headers[HR_SESSION_HEADER]

      // Same resolution rules as `/api/v1/offers`: header always wins over
      // anything an LLM could have filled. There's no body `call_id` here
      // (the HR tool doesn't template one); the resolver handles that
      // cleanly by treating `undefined` as absent.
      const resolved = resolveCallId(headerValue, undefined)

      enrichWideEvent(req, {
        load_id,
        agreed_rate,
        carrier_mc,
        call_id_source: resolved.source,
      })

      if (resolved.call_id === null) {
        enrichWideEvent(req, { failure_stage: 'call_id_unresolvable' })
        req.log.warn(
          { load_id, header_present: Boolean(headerValue) },
          `book_load: ${HR_SESSION_HEADER} header missing or unresolvable; the HappyRobot POST Webhook node needs to send ${HR_SESSION_HEADER}=@session_id.`,
        )
        // Always strict here -- without a call_id there is no row to
        // flip to `booked` and no way to join the booking against the
        // negotiation ledger. A flag-off fallback would produce silent
        // orphan rows, which is what we're trying to stop.
        return reply.code(422).send({
          error: 'Unprocessable Entity',
          message: `Cannot book without a session id. Set the \`${HR_SESSION_HEADER}\` header to \`@session_id\` in the HappyRobot POST Webhook node.`,
          statusCode: 422,
        })
      }
      const call_id = resolved.call_id
      enrichWideEvent(req, { call_id })

      try {
        const load = await convexService.loads.getByLoadId(load_id)
        if (!load) {
          enrichWideEvent(req, { failure_stage: 'load_not_found' })
          return reply.code(404).send({
            error: 'Not Found',
            message: `Load ${load_id} not found`,
            statusCode: 404,
          })
        }

        enrichWideEvent(req, {
          loadboard_rate: load.loadboard_rate,
          load_status: load.status,
        })

        // The load is already booked / expired / mid-negotiation.
        // Returning 409 is cleaner than a silent 200 because HR's workflow
        // treats non-2xx as a tool failure and surfaces it to the caller
        // instead of pretending the booking succeeded.
        if (load.status !== 'available' && load.status !== 'in_negotiation') {
          enrichWideEvent(req, { failure_stage: 'load_not_bookable' })
          return reply.code(409).send({
            error: 'Conflict',
            message: `Load ${load_id} is not bookable (status: ${load.status}).`,
            statusCode: 409,
          })
        }

        // Rate guard: HR's LLM fills `agreed_rate` from the conversation,
        // so a hallucinated $900 on a $3k load would otherwise book
        // silently. `[loadboard_rate * (1 - margin%), loadboard_rate]`
        // matches the same margin the offer negotiator uses for auto-accept.
        const minAcceptableRate = load.loadboard_rate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100)
        if (agreed_rate < minAcceptableRate || agreed_rate > load.loadboard_rate) {
          enrichWideEvent(req, {
            failure_stage: 'rate_out_of_bounds',
            min_acceptable_rate: minAcceptableRate,
          })
          req.log.warn(
            { call_id, load_id, agreed_rate, loadboard_rate: load.loadboard_rate },
            'book_load: agreed_rate outside acceptable margin; rejecting to prevent low-ball booking',
          )
          return reply.code(422).send({
            error: 'Unprocessable Entity',
            message: `Agreed rate $${agreed_rate} is outside the acceptable range [$${Math.round(
              minAcceptableRate,
            )}, $${load.loadboard_rate}] for load ${load_id}.`,
            statusCode: 422,
          })
        }

        const now = new Date().toISOString()
        await convexService.loads.updateStatus(load_id, 'booked')

        // Authoritative booking write: forces `outcome: 'booked'` along
        // with `carrier_mc` / `load_id` / `final_rate` so the call row
        // can never show a booked load with `carrier_mc: 'unknown'` or
        // an earlier classify-written `dropped`. `upsertFromOffer` would
        // silently keep the older outcome; `markBooked` is purpose-built
        // to close that hole.
        await convexService.calls.markBooked({
          call_id,
          load_id,
          carrier_mc,
          final_rate: agreed_rate,
          started_at: now,
          ended_at: now,
        })

        bookingOutcomeCounter.add(1, { result: 'accepted_after_max_rounds' })

        enrichWideEvent(req, {
          booked: true,
          final_rate: agreed_rate,
          discount_percent: ((load.loadboard_rate - agreed_rate) / load.loadboard_rate) * 100,
        })

        return {
          booked: true,
          load_id,
          call_id,
          agreed_rate,
          loadboard_rate: load.loadboard_rate,
          message: `Load ${load_id} booked at $${agreed_rate}.`,
        }
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'book_load_processing' })
        req.log.error({ err, call_id, load_id }, 'Failed to book load')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to book load',
          statusCode: 500,
        })
      }
    },
  )
}

export default bookLoadRoute
