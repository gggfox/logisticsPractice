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

import type { FastifyRequest } from 'fastify'
import type { WideEvent } from './wide-event.js'

type RequestLike = object

const store = new WeakMap<RequestLike, WideEvent>()

export function attachWideEvent(req: FastifyRequest, event: WideEvent): void {
  store.set(req, event)
}

export function getWideEvent(req: FastifyRequest): WideEvent | undefined {
  return store.get(req)
}

export function enrichWideEvent(req: FastifyRequest, fields: Record<string, unknown>): void {
  const event = store.get(req)
  if (event) Object.assign(event, fields)
}
