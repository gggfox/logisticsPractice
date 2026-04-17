import crypto from 'node:crypto'
import type { ApiMiddleware } from 'motia'
import { attachWideEvent } from '../observability/wide-event-store.js'
import {
  type WideEvent,
  createWideEvent,
  emitWideEvent,
  toErrorShape,
} from '../observability/wide-event.js'

function hashApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
}

function truncatePath(path: string | undefined): string | undefined {
  if (!path) return undefined
  return path.length > 200 ? `${path.slice(0, 200)}...` : path
}

/**
 * One-wide-event-per-request middleware. Seeds the event with HTTP context,
 * attaches it to the FlowContext for the handler to enrich, and emits exactly
 * once in `finally` with `status_code`, `duration_ms`, and any error shape.
 *
 * Register AFTER `rateLimiter` but the order among other middlewares doesn't
 * matter for correctness; we emit in `finally` so errors are always captured.
 */
export const wideEventMiddleware: ApiMiddleware = async (req, ctx, next) => {
  const startedAt = Date.now()
  const apiKey = req.headers['x-api-key'] as string | undefined
  const debugHeader = req.headers['x-debug']

  const event: WideEvent = createWideEvent(ctx, ctx.trigger.path ?? 'unknown', {
    http_method: ctx.trigger.method,
    http_path: truncatePath(ctx.trigger.path),
    api_key_hash: hashApiKey(apiKey),
    user_agent: req.headers['user-agent'],
    ip: req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'],
  })

  attachWideEvent(ctx, event)

  const debug = debugHeader === '1' || debugHeader === 'true'

  try {
    const result = await next()
    event.status_code = result.status
    event.outcome = result.status >= 500 ? 'error' : result.status >= 400 ? 'rejected' : 'success'
    emitWideEvent(ctx.logger, event, startedAt, { debug })
    return result
  } catch (err) {
    event.status_code = 500
    event.outcome = 'error'
    event.error = toErrorShape(err)
    emitWideEvent(ctx.logger, event, startedAt, { debug })
    throw err
  }
}
