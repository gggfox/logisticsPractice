/**
 * In-memory token-bucket rate limiter keyed by `x-api-key` (fallback:
 * `'anonymous'`). Same budget as the old Motia middleware and still
 * registered before auth so unauth'd traffic consumes budget and can't
 * brute-force keys for free.
 *
 * Keyed by api key rather than IP because Traefik sets
 * `x-forwarded-for` from client-controlled headers.
 */

import { RATE_LIMIT } from '@carrier-sales/shared'
import rateLimit from '@fastify/rate-limit'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

const plugin: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: RATE_LIMIT.maxRequests,
    timeWindow: RATE_LIMIT.windowMs,
    keyGenerator: (req) => {
      const key = req.headers['x-api-key']
      if (typeof key === 'string' && key.length > 0) return key
      if (Array.isArray(key) && key.length > 0 && typeof key[0] === 'string') {
        return key[0]
      }
      return 'anonymous'
    },
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (_req, context) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
      statusCode: 429,
    }),
  })
}

export default fp(plugin, { name: 'rate-limiter' })
