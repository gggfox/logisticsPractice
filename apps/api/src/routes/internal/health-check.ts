import type { FastifyPluginAsync } from 'fastify'
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from '../../config.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

const HealthResponseSchema = z.object({
  status: z.literal('healthy'),
  timestamp: z.string().datetime(),
  version: z.string(),
})

const healthRoute: FastifyPluginAsync = async (app) => {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/health',
    {
      schema: {
        response: { 200: HealthResponseSchema },
      },
    },
    async (req) => {
      // Health checks fire every 30s from the container runtime and every
      // few seconds from Traefik; keep the event minimal. Errors still
      // always emit, successes obey WIDE_EVENT_SUCCESS_SAMPLE_RATE.
      enrichWideEvent(req, { probe: true })
      return {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        version: config.observability.version,
      }
    },
  )
}

export default healthRoute
