/**
 * Wide-event logging primitives. One structured event per handler invocation,
 * enriched with business context, correlated to OTel traces via `trace_id`.
 * Emitted through `ctx.logger` so SigNoz picks it up over OTLP.
 *
 * See docs/observability.md and .cursor/rules/wide-event-logging.mdc for the
 * contract and conventions.
 */

import { config } from '../config.js'

// Minimal structural context types -- matches Motia's FlowContext without
// coupling to its generics so the helpers work for api/queue/cron handlers
// regardless of their enqueue/input type parameters.
type TriggerInfoLike = {
  type?: string
  path?: string
  method?: string
  topic?: string
}

type CtxLike = {
  traceId?: string
  trigger?: TriggerInfoLike
}

type LoggerLike = {
  info: (msg: string, meta?: Record<string, unknown>) => void
  warn: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, meta?: Record<string, unknown>) => void
}

type CtxWithLogger = CtxLike & { logger: LoggerLike }

export type WideEventOutcome = 'success' | 'error' | 'rejected'

export type WideEvent = {
  timestamp: string
  service: string
  service_version: string
  service_namespace: string
  deployment_region: string
  step_name: string
  trigger_type?: string
  trigger_path?: string
  trigger_method?: string
  trigger_topic?: string
  trace_id?: string
  flows?: readonly string[]
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

export function createWideEvent(
  ctx: CtxLike,
  stepName: string,
  extras: Record<string, unknown> = {},
): WideEvent {
  return {
    timestamp: new Date().toISOString(),
    service: config.observability.service,
    service_version: config.observability.version,
    service_namespace: config.observability.namespace,
    deployment_region: config.observability.region,
    step_name: stepName,
    trigger_type: ctx.trigger?.type,
    trigger_path: ctx.trigger?.path,
    trigger_method: ctx.trigger?.method,
    trigger_topic: ctx.trigger?.topic,
    trace_id: ctx.traceId,
    ...extras,
  }
}

export function toErrorShape(err: unknown): WideEvent['error'] {
  if (err instanceof Error) {
    return {
      type: err.name,
      message: err.message,
      code: (err as { code?: string }).code,
      retriable: (err as { retriable?: boolean }).retriable,
    }
  }
  return { type: 'UnknownError', message: String(err) }
}

/**
 * Tail-style sampling decision. Always keeps errors and slow requests, and
 * always keeps requests with the `x-debug: 1` header. Otherwise samples
 * successes at `WIDE_EVENT_SUCCESS_SAMPLE_RATE` (default 1.0 = keep all).
 *
 * Separate from OTel trace sampling -- this is just whether we emit the
 * structured log line. The trace itself is governed by `sampling_ratio` in
 * config-production.yaml.
 */
export function shouldEmit(event: WideEvent, extras: { debug?: boolean } = {}): boolean {
  if (extras.debug) return true
  if (event.outcome === 'error') return true
  if (typeof event.status_code === 'number' && event.status_code >= 500) return true
  if (
    typeof event.duration_ms === 'number' &&
    event.duration_ms > config.observability.slowMs
  ) {
    return true
  }
  if (config.observability.successSampleRate >= 1) return true
  return Math.random() < config.observability.successSampleRate
}

/**
 * Finalize and emit a wide event exactly once. Computes `duration_ms`, applies
 * the sampling policy, and logs at `info` (success) or `error` (failure).
 */
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
    logger.error(msg, event as Record<string, unknown>)
  } else {
    logger.info(msg, event as Record<string, unknown>)
  }
}

/**
 * Wraps a non-HTTP handler (queue / cron / internal) so it emits exactly one
 * wide event when the handler resolves or rejects. Handlers receive a builder
 * fn (`enrich`) they call to attach business fields to the in-flight event.
 *
 * @example
 *   export const handler: Handlers<typeof config> = (input, ctx) =>
 *     withWideEvent('ClassifyCall', ctx, async (enrich) => {
 *       enrich({ call_id: input.call_id })
 *       const outcome = classify(input)
 *       enrich({ outcome })
 *     })
 */
export async function withWideEvent<T>(
  stepName: string,
  ctx: CtxWithLogger,
  fn: (enrich: (fields: Record<string, unknown>) => void, event: WideEvent) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  const event = createWideEvent(ctx, stepName)
  const enrich = (fields: Record<string, unknown>): void => {
    Object.assign(event, fields)
  }

  try {
    const result = await fn(enrich, event)
    event.outcome = event.outcome ?? 'success'
    emitWideEvent(ctx.logger, event, startedAt)
    return result
  } catch (err) {
    event.outcome = 'error'
    event.error = toErrorShape(err)
    emitWideEvent(ctx.logger, event, startedAt)
    throw err
  }
}
