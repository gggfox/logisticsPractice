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

function extractApiKey(req: FastifyRequest): string | undefined {
  const raw = req.headers['x-api-key']
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
    return raw[0]
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
