/**
 * Wide-event logging primitives. One structured event per handler invocation,
 * enriched with business context, correlated to OTel traces via `trace_id`.
 *
 * HTTP routes let the wide-event Fastify plugin seed and emit the event;
 * BullMQ workers and cron handlers call
 * `withWideEvent(stepName, { logger }, fn)` directly.
 *
 * See docs/observability.md for the contract and field conventions.
 */

import { trace } from '@opentelemetry/api'
import { config } from '../config.js'

type LoggerLike = {
  info: (meta: Record<string, unknown>, msg?: string) => void
  warn: (meta: Record<string, unknown>, msg?: string) => void
  error: (meta: Record<string, unknown>, msg?: string) => void
}

export type WideEventOutcome = 'success' | 'error' | 'rejected'

export type WideEventTriggerType = 'api' | 'queue' | 'cron'

export type WideEvent = {
  timestamp: string
  service: string
  service_version: string
  service_namespace: string
  deployment_region: string
  step_name: string
  trigger_type?: WideEventTriggerType
  trigger_path?: string
  trigger_method?: string
  trigger_topic?: string
  trace_id?: string
  outcome?: WideEventOutcome
  duration_ms?: number
  status_code?: number
  error?: {
    type: string
    message: string
    code?: string
    retriable?: boolean
  }
} & Record<string, unknown>

export type WideEventSeed = {
  trigger_type?: WideEventTriggerType
  trigger_path?: string
  trigger_method?: string
  trigger_topic?: string
  trace_id?: string
  extras?: Record<string, unknown>
}

export function currentTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId
}

export function createWideEvent(stepName: string, seed: WideEventSeed = {}): WideEvent {
  const event: WideEvent = {
    timestamp: new Date().toISOString(),
    service: config.observability.service,
    service_version: config.observability.version,
    service_namespace: config.observability.namespace,
    deployment_region: config.observability.region,
    step_name: stepName,
    trace_id: seed.trace_id ?? currentTraceId(),
    ...(seed.extras ?? {}),
  }
  if (seed.trigger_type !== undefined) event.trigger_type = seed.trigger_type
  if (seed.trigger_path !== undefined) event.trigger_path = seed.trigger_path
  if (seed.trigger_method !== undefined) event.trigger_method = seed.trigger_method
  if (seed.trigger_topic !== undefined) event.trigger_topic = seed.trigger_topic
  return event
}

export function toErrorShape(err: unknown): WideEvent['error'] {
  if (err instanceof Error) {
    const e: { code?: string; retriable?: boolean } = err as {
      code?: string
      retriable?: boolean
    }
    const shape: NonNullable<WideEvent['error']> = {
      type: err.name,
      message: err.message,
    }
    if (e.code !== undefined) shape.code = e.code
    if (e.retriable !== undefined) shape.retriable = e.retriable
    return shape
  }
  return { type: 'UnknownError', message: String(err) }
}

/**
 * Tail-style sampling. Always keep errors, slow requests, and explicit
 * debug flags; sample remaining successes at the configured rate.
 */
export function shouldEmit(event: WideEvent, options: { debug?: boolean } = {}): boolean {
  if (options.debug) return true
  if (event.outcome === 'error') return true
  if (typeof event.status_code === 'number' && event.status_code >= 500) return true
  if (typeof event.duration_ms === 'number' && event.duration_ms > config.observability.slowMs) {
    return true
  }
  if (config.observability.successSampleRate >= 1) return true
  return Math.random() < config.observability.successSampleRate
}

export function emitWideEvent(
  logger: LoggerLike,
  event: WideEvent,
  startedAt: number,
  options: { debug?: boolean } = {},
): void {
  event.duration_ms = Date.now() - startedAt
  if (!event.outcome) event.outcome = event.error ? 'error' : 'success'
  if (!shouldEmit(event, options)) return

  const msg = `${event.step_name} ${event.outcome}`
  if (event.outcome === 'error') {
    logger.error(event, msg)
  } else {
    logger.info(event, msg)
  }
}

/**
 * Wraps a non-HTTP handler (BullMQ worker / cron tick) so it emits exactly
 * one wide event when the handler resolves or rejects. Handlers receive an
 * `enrich` helper they call to attach business fields to the in-flight
 * event.
 *
 * @example
 *   await withWideEvent('ClassifyCall', { logger }, async (enrich) => {
 *     enrich({ call_id: input.call_id })
 *     const outcome = classify(input)
 *     enrich({ outcome })
 *   })
 */
export async function withWideEvent<T>(
  stepName: string,
  deps: { logger: LoggerLike; seed?: WideEventSeed },
  fn: (enrich: (fields: Record<string, unknown>) => void, event: WideEvent) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  const event = createWideEvent(stepName, deps.seed ?? {})
  const enrich = (fields: Record<string, unknown>): void => {
    Object.assign(event, fields)
  }

  try {
    const result = await fn(enrich, event)
    event.outcome = event.outcome ?? 'success'
    emitWideEvent(deps.logger, event, startedAt)
    return result
  } catch (err) {
    event.outcome = 'error'
    event.error = toErrorShape(err)
    emitWideEvent(deps.logger, event, startedAt)
    throw err
  }
}
