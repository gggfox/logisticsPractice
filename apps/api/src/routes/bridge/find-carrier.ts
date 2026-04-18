import { CarrierVerificationResponseSchema } from '@carrier-sales/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { carrierVerificationCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { getVerifyCarrierQueue } from '../../queues/index.js'
import { normalizeCarrierId, verifyCarrier } from '../../services/fmcsa.service.js'
import { ErrorBodySchema } from '../_error-schema.js'

const ParamsSchema = z.object({
  mc_number: z.string().min(1),
})

const findCarrierRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/carriers/:mc_number',
    {
      schema: {
        tags: ['carriers'],
        summary: 'Verify a carrier via FMCSA',
        description:
          'Looks up a carrier by DOT number against FMCSA QCMobile and enqueues an enrichment job on eligibility. Note: the path parameter is a DOT number -- FMCSA treats the QCMobile carriers/{id} endpoint as a DOT lookup, not an MC docket.',
        params: ParamsSchema,
        response: {
          200: CarrierVerificationResponseSchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const { mc_number } = req.params
      enrichWideEvent(req, { mc_number })

      const normalized = normalizeCarrierId(mc_number)
      if (normalized.kind === 'invalid') {
        enrichWideEvent(req, {
          normalize_result: 'invalid',
          reason: normalized.reason,
          eligible: false,
          operating_status: 'NOT_FOUND',
        })
        carrierVerificationCounter.add(1, { eligible: 'false', outcome: 'invalid_input' })
        return {
          mc_number,
          legal_name: 'Unknown',
          is_eligible: false,
          operating_status: 'NOT_FOUND',
          reason: 'Invalid carrier identifier',
        }
      }

      try {
        const result = await verifyCarrier(normalized.digits)

        enrichWideEvent(req, {
          eligible: result.is_eligible,
          legal_name: result.legal_name,
          operating_status: result.operating_status,
          reason: result.reason,
          enqueued_enrichment: result.is_eligible,
        })
        carrierVerificationCounter.add(1, { eligible: String(result.is_eligible) })

        if (result.is_eligible) {
          await getVerifyCarrierQueue().add('verify', {
            mc_number: result.mc_number,
            legal_name: result.legal_name,
          })
        }

        return result
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'fmcsa_lookup' })
        req.log.error({ err, mc_number }, 'Failed to verify carrier')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to verify carrier',
          statusCode: 500,
        })
      }
    },
  )
}

export default findCarrierRoute
