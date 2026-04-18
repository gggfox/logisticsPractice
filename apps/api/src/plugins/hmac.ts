/**
 * HMAC signature verifier for webhook routes.
 *
 * The verifier computes `sha256(rawBody)` with `WEBHOOK_SECRET` and
 * compares in constant time to the hex digest carried in
 * `x-webhook-signature`. `fastify-raw-body` exposes `req.rawBody` so
 * we HMAC the exact bytes the caller signed rather than a re-serialized
 * `JSON.stringify(req.body)` (key order is not preserved by a round-trip).
 *
 * In the current deployment the call-completed webhook is authenticated
 * via `x-api-key` alone (HappyRobot's workflow webhook UI can only send
 * static headers). `verifyWebhookSignature` is therefore used as
 * *telemetry* -- the route records the outcome as
 * `signature_state: 'valid' | 'invalid' | 'absent'` but never 401s on
 * it. The `hmacVerifier` plugin below still short-circuits 401 on
 * failure and is kept for any future signing-proxy scenario where the
 * signature is the actual auth gate.
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
  // No secret configured = we have nothing to compare against. Return false
  // so an unset `WEBHOOK_SECRET` can never produce a spurious "valid" state.
  if (config.bridge.webhookSecret === '') return false
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
