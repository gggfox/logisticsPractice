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
  // Hard-coded literal marker: bumped when we ship a HR-integration
  // refactor so "is the new build live?" is verifiable with a single
  // unauthenticated curl, even when `SERVICE_VERSION` is stuck at the
  // Dokploy env-expansion literal `"${DOKPLOY_COMMIT_SHA}"`. Search for
  // `hr_integration:` to find every bump site.
  hr_integration: z.string(),
})

const healthRoute: FastifyPluginAsync = async (app) => {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/health',
    {
      schema: {
        tags: ['internal'],
        summary: 'Liveness probe',
        description:
          'Public health probe used by container runtimes and Traefik. Bypasses API-key auth.',
        security: [],
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
        // `runs-api-v2` = the refactor that routes HR backfills through
        // `/api/v1/runs/:run_id` on `platform.happyrobot.ai` instead of
        // the non-existent `/api/v1/calls/:session_id`. If this field is
        // missing from the response the deployed container is pre-refactor.
        hr_integration: 'runs-api-v2',
      }
    },
  )
}

export default healthRoute
