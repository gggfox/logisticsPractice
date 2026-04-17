import { type Handlers, type StepConfig, api } from 'motia'
import { config as appConfig } from '../../config.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

export const config = {
  name: 'HealthCheck',
  description: 'API health check endpoint',
  triggers: [
    api('GET', '/api/v1/health', {
      middleware: [wideEventMiddleware],
    }),
  ],
  flows: ['internal-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (_req, ctx) => {
  // Health checks fire every 30s from the container runtime and every few
  // seconds from Traefik; keep the event minimal and rely on
  // WIDE_EVENT_SUCCESS_SAMPLE_RATE (default 1.0, tune down in prod) to avoid
  // spam. Errors still always emit.
  enrichWideEvent(ctx, { probe: true })

  return {
    status: 200,
    body: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: appConfig.observability.version,
    },
  }
}
