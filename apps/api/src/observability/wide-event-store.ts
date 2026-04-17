import type { WideEvent } from './wide-event.js'

// Intentionally minimal `ctx` type so this works for any FlowContext variance
// (api, queue, cron, with/without enqueue generics). The WeakMap is keyed by
// reference identity, not structural type.
type CtxLike = object

const store = new WeakMap<CtxLike, WideEvent>()

export function attachWideEvent(ctx: CtxLike, event: WideEvent): void {
  store.set(ctx, event)
}

/**
 * Retrieve the wide event attached to the current request by
 * `wideEventMiddleware`. Handlers use this to enrich the in-flight event with
 * business context via `enrichWideEvent(ctx, { mc_number, ... })`.
 *
 * Returns `undefined` only if the middleware was not registered -- during
 * normal operation the event always exists inside an HTTP handler that
 * declares `wideEventMiddleware` in its `middleware: [...]` array.
 */
export function getWideEvent(ctx: CtxLike): WideEvent | undefined {
  return store.get(ctx)
}

export function enrichWideEvent(ctx: CtxLike, fields: Record<string, unknown>): void {
  const event = getWideEvent(ctx)
  if (event) Object.assign(event, fields)
}
