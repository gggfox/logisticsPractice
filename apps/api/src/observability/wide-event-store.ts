/**
 * Per-request wide-event attachment.
 *
 * The wide-event Fastify plugin seeds a `WideEvent` in `onRequest` and
 * stashes it on the `FastifyRequest` so route handlers can enrich it with
 * business context via `enrichWideEvent(req, { ... })`. The plugin's
 * `onResponse` / `onError` hooks emit it exactly once.
 *
 * Storage is a `WeakMap<FastifyRequest, WideEvent>`: no manual cleanup, no
 * cross-request leakage, and no dependency on `AsyncLocalStorage` because
 * every call site already has the request in hand.
 */

import { type Attributes, trace } from '@opentelemetry/api'
import type { FastifyRequest } from 'fastify'
import type { WideEvent } from './wide-event.js'

type RequestLike = object

const store = new WeakMap<RequestLike, WideEvent>()

// Fields that already live on the OTel resource or are too large / too
// sensitive to mirror onto an individual span. Wide-event-only; they stay
// on the structured log record.
const SPAN_SKIP_KEYS = new Set<string>([
  'timestamp',
  'trace_id',
  'service',
  'service_version',
  'service_namespace',
  'deployment_region',
  'transcript',
  'error',
])

/**
 * Mirror low-size, trace-relevant fields from the wide event onto the
 * currently active OTel span so SigNoz Traces surfaces business context
 * (load_id, outcome, api_key_hash, ...) alongside HTTP/DB attributes.
 * High-cardinality span attributes are fine -- they're per-request, not
 * per-time-series like metric attributes.
 */
function mirrorToActiveSpan(fields: Record<string, unknown>): void {
  const span = trace.getActiveSpan()
  if (!span) return
  const attrs: Attributes = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SPAN_SKIP_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attrs[`app.${key}`] = value
    }
  }
  if (Object.keys(attrs).length > 0) span.setAttributes(attrs)
}

export function attachWideEvent(req: FastifyRequest, event: WideEvent): void {
  store.set(req, event)
}

export function getWideEvent(req: FastifyRequest): WideEvent | undefined {
  return store.get(req)
}

export function enrichWideEvent(req: FastifyRequest, fields: Record<string, unknown>): void {
  const event = store.get(req)
  if (event) Object.assign(event, fields)
  mirrorToActiveSpan(fields)
}
