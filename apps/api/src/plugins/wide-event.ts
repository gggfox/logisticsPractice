/**
 * One wide event per HTTP request.
 *
 * Hooks:
 * - `onRequest` seeds a `WideEvent` with HTTP context (method, path,
 *   hashed api key, user-agent, ip) and stashes it on the request via
 *   `attachWideEvent`. Handlers call `enrichWideEvent(req, { ... })` to
 *   add business fields.
 * - `onResponse` emits the event on success with `status_code`,
 *   `duration_ms`, and `outcome`.
 * - `onError` emits the event with an `error` shape attached.
 *
 * Must register AFTER rate-limiter + api-key-auth so 401 / 429 responses
 * get the final status code captured on the event.
 */

import crypto from 'node:crypto'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { config } from '../config.js'
import { attachWideEvent, getWideEvent } from '../observability/wide-event-store.js'
import {
  type WideEvent,
  createWideEvent,
  currentTraceId,
  emitWideEvent,
  toErrorShape,
} from '../observability/wide-event.js'

declare module 'fastify' {
  interface FastifyRequest {
    __wideEventStart?: number
    __wideEventEmitted?: boolean
  }
}

function hashApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
}

function truncatePath(path: string | undefined): string | undefined {
  if (!path) return undefined
  return path.length > 200 ? `${path.slice(0, 200)}...` : path
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function resolveStepName(req: FastifyRequest): string {
  const routeUrl = req.routeOptions?.url
  if (routeUrl) return routeUrl
  return `${req.method} ${req.url}`
}

function debugEnabled(req: FastifyRequest): boolean {
  if (!config.observability.debugHeaderEnabled) return false
  const header = headerString(req.headers['x-debug'])
  return header === '1' || header === 'true'
}

function finalize(req: FastifyRequest, statusCode: number, err?: unknown): void {
  if (req.__wideEventEmitted) return
  const event = getWideEvent(req)
  const startedAt = req.__wideEventStart ?? Date.now()
  if (!event) return
  event.status_code = statusCode
  if (err !== undefined) {
    event.outcome = 'error'
    event.error = toErrorShape(err)
  } else if (!event.outcome) {
    event.outcome = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'rejected' : 'success'
  }
  emitWideEvent(req.log, event, startedAt, { debug: debugEnabled(req) })
  req.__wideEventEmitted = true
}

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req) => {
    const apiKey = headerString(req.headers['x-api-key'])
    const ip =
      headerString(req.headers['x-forwarded-for']) ??
      headerString(req.headers['x-real-ip']) ??
      req.ip
    const event: WideEvent = createWideEvent(resolveStepName(req), {
      trigger_type: 'api',
      trigger_path: truncatePath(req.url),
      trigger_method: req.method,
      trace_id: currentTraceId(),
      extras: {
        http_method: req.method,
        http_path: truncatePath(req.url),
        api_key_hash: hashApiKey(apiKey),
        user_agent: headerString(req.headers['user-agent']),
        ip,
      },
    })
    req.__wideEventStart = Date.now()
    attachWideEvent(req, event)
  })

  app.addHook('onResponse', async (req, reply) => {
    finalize(req, reply.statusCode)
  })

  app.addHook('onError', async (req, reply, err) => {
    finalize(req, reply.statusCode || 500, err)
  })
}

export default fp(plugin, { name: 'wide-event' })
