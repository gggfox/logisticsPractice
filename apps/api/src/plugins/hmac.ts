/**
 * HMAC signature verifier for webhook routes.
 *
 * Usage: register this plugin on the webhook prefix (or per-route) after
 * `fastify-raw-body` has exposed `req.rawBody`. The verifier computes
 * `sha256(rawBody)` with `WEBHOOK_SECRET` and compares in constant time
 * to the hex digest carried in `x-webhook-signature`.
 *
 * Fixes the old Motia weakness: we HMAC the exact request body bytes
 * rather than `JSON.stringify(req.body)`, so reordered keys can't break
 * verification.
 *
 * On failure this plugin responds 401 and short-circuits. Callers still
 * enrich the wide event with `signature_valid: false` and bump the
 * `carrier_sales.webhook.received` counter in the route handler for
 * alerting; doing it here would couple webhook metrics to plugin code.
 */

import crypto from 'node:crypto'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { config } from '../config.js'
import { enrichWideEvent } from '../observability/wide-event-store.js'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string | Buffer
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function verify(rawBody: string | Buffer, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', config.bridge.webhookSecret)
    .update(rawBody)
    .digest('hex')
  // REQUIRED: length guard. timingSafeEqual throws on mismatched lengths.
  if (signature.length !== expected.length) return false
  const sigBuf = Buffer.from(signature, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}

export function verifyWebhookSignature(req: FastifyRequest): boolean {
  const signature = headerString(req.headers['x-webhook-signature'])
  if (!signature) return false
  const rawBody = req.rawBody
  if (rawBody === undefined) return false
  return verify(rawBody, signature)
}

/**
 * Plugin variant that enforces signature verification on every request in
 * its scope. Register via `app.register(hmacVerifier)` inside a webhook
 * plugin / encapsulation.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    const ok = verifyWebhookSignature(req)
    enrichWideEvent(req, { signature_valid: ok })
    if (!ok) {
      req.log.warn({ path: req.url }, 'Invalid webhook signature')
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
        statusCode: 401,
      })
      return reply
    }
  })
}

export default fp(plugin, { name: 'hmac-verifier' })
