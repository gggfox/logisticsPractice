/**
 * API-key authentication as a `preHandler` hook.
 *
 * Accepts either the bridge key (general use) or the admin key (e.g.
 * `/api/v1/admin/seed`). `/api/v1/health` is explicitly bypassed so
 * container healthchecks and Traefik liveness probes can hit it without
 * a secret -- same carve-out as the old Motia middleware.
 *
 * 401 responses use `{ error, message, statusCode }` -- identical shape
 * for "missing" and "invalid" to avoid an oracle.
 *
 * Swagger UI carve-out: requests to `/docs/**` may also pass the key as
 * a `?api_key=...` query string. Browsers can't attach custom headers
 * when a user pastes a URL, so this lets the interactive docs page load
 * in a tab. Once the UI is open, Swagger's `persistAuthorization` stores
 * the key in localStorage and subsequent "Try it out" calls send it in
 * the `x-api-key` header as normal.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { config } from '../config.js'

const UNAUTHORIZED_BODY = {
  error: 'Unauthorized',
  message: 'Unauthorized',
  statusCode: 401,
} as const

const BYPASS_PATHS = new Set<string>(['/api/v1/health'])
const DOCS_PREFIX = '/docs'

function isDocsRoute(req: FastifyRequest): boolean {
  const routeUrl = req.routeOptions.url
  if (typeof routeUrl === 'string' && routeUrl.startsWith(DOCS_PREFIX)) {
    return true
  }
  // Fallback for static assets whose route pattern is a wildcard; the
  // raw URL still starts with `/docs/`.
  return req.url.startsWith(`${DOCS_PREFIX}/`) || req.url === DOCS_PREFIX
}

function extractApiKey(req: FastifyRequest): string | undefined {
  const raw = req.headers['x-api-key']
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
    return raw[0]
  }

  if (isDocsRoute(req)) {
    const query = req.query as { api_key?: unknown } | undefined
    const q = query?.api_key
    if (typeof q === 'string' && q.length > 0) return q
    if (Array.isArray(q) && q.length > 0 && typeof q[0] === 'string') {
      return q[0]
    }
  }

  return undefined
}

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.url && BYPASS_PATHS.has(req.routeOptions.url)) {
      return
    }

    const apiKey = extractApiKey(req)
    if (!apiKey) {
      reply.code(401).send(UNAUTHORIZED_BODY)
      return reply
    }

    const validKeys = [config.bridge.apiKey, config.bridge.adminKey]
    if (!validKeys.includes(apiKey)) {
      reply.code(401).send(UNAUTHORIZED_BODY)
      return reply
    }
  })
}

export default fp(plugin, { name: 'api-key-auth' })
