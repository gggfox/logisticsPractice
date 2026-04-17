import type { FastifyPluginAsync } from 'fastify'
import seedLoadsRoute from './admin/seed-loads.js'
import findCarrierRoute from './bridge/find-carrier.js'
import findLoadRoute from './bridge/find-load.js'
import findLoadsRoute from './bridge/find-loads.js'
import logOfferRoute from './bridge/log-offer.js'
import getTranscriptRoute from './internal/get-transcript.js'
import healthCheckRoute from './internal/health-check.js'
import callCompletedRoute from './webhooks/call-completed.js'

/**
 * Single registration point for every HTTP route. Keeps server.ts
 * routing-agnostic and makes adding a new route a one-line edit here.
 *
 * All routes share the plugin chain registered in server.ts:
 * security-headers -> rate-limiter -> api-key-auth -> wide-event.
 * The api-key-auth plugin bypasses /api/v1/health. The call-completed
 * webhook verifies its HMAC signature inside the route handler using
 * the raw body captured by fastify-raw-body (opt-in via route config).
 */
const routes: FastifyPluginAsync = async (app) => {
  await app.register(healthCheckRoute)

  await app.register(findLoadsRoute)
  await app.register(findLoadRoute)
  await app.register(findCarrierRoute)
  await app.register(logOfferRoute)

  await app.register(getTranscriptRoute)
  await app.register(seedLoadsRoute)

  await app.register(callCompletedRoute)
}

export default routes
