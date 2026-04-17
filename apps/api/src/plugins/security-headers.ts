/**
 * Security response headers applied to every reply. Registered as the
 * first plugin in `server.ts` so the headers show up on 4xx / 5xx /
 * rate-limit responses too.
 *
 * - `X-Content-Type-Options: nosniff` -- defeats MIME sniffing on error
 *   bodies.
 * - `X-Frame-Options: DENY` -- the API only serves JSON; never framed.
 * - `Referrer-Policy: no-referrer` -- URLs hold no user-linkable context,
 *   but tightening the default is free.
 * - `Strict-Transport-Security` -- behind Traefik/HTTPS, force HTTPS on
 *   any client that accidentally hits HTTP. `includeSubDomains` is safe
 *   because the API domain is dedicated.
 *
 * CSP intentionally omitted: the API never returns HTML.
 */

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

const HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [name, value] of Object.entries(HEADERS)) {
      if (!reply.getHeader(name)) {
        reply.header(name, value)
      }
    }
    return payload
  })
}

export default fp(plugin, { name: 'security-headers' })
