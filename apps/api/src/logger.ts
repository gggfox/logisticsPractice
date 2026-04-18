/**
 * Process-wide pino logger.
 *
 * Fastify uses its own `req.log` (wired in `server.ts`), which pino
 * instrumentation auto-injects `trace_id` / `span_id` into. For standalone
 * code paths (BullMQ workers, cron handlers, top-level boot) import this
 * singleton directly.
 *
 * Two delivery paths from a single pino call (wired via `pino.multistream`):
 *   1. Original pino destination (stdout) -- kept so docker/dokploy logs,
 *      `pnpm dev` stdout, and any host log shipper still see the same
 *      newline-delimited JSON they always did.
 *   2. OTel log bridge -- each record is parsed and emitted as an OTel
 *      `LogRecord` via `logs.getLogger(...)`, which the NodeSDK in
 *      `./otel.js` has configured to ship to SigNoz's OTLP collector.
 *
 * We intentionally do NOT use a pino `transport` (worker thread) here.
 * Transports serialize records across a MessageChannel to a worker, which
 * puts the OTel SDK in a separate isolate from the one set up by
 * `./otel.js` -- `logs.getLogger()` in that worker would see a NoopLogger
 * and silently drop everything. Doing the bridge in-process is what makes
 * pino logs show up in SigNoz's Logs Explorer.
 *
 * The `@opentelemetry/instrumentation-pino` package does exactly the same
 * wiring automatically, but only when its ESM `import-in-the-middle` hook
 * is registered via Node's `--import` flag. `tsx watch` uses its own ESM
 * loader and doesn't install that hook for us, so we wire the bridge by
 * hand.
 */

import { Writable } from 'node:stream'
import { SeverityNumber, logs } from '@opentelemetry/api-logs'
import { type Logger, multistream, pino } from 'pino'
import { config } from './config.js'

const isDev = config.nodeEnv !== 'production'

const baseLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: {
    service: config.observability.service,
    service_version: config.observability.version,
    service_namespace: config.observability.namespace,
    deployment_region: config.observability.region,
  },
})

const PINO_LEVEL_TO_OTEL_SEV: Record<number, SeverityNumber> = {
  10: SeverityNumber.TRACE,
  20: SeverityNumber.DEBUG,
  30: SeverityNumber.INFO,
  40: SeverityNumber.WARN,
  50: SeverityNumber.ERROR,
  60: SeverityNumber.FATAL,
}

const PINO_LEVEL_TO_TEXT: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

function createOtelPinoStream(): Writable {
  const otelLogger = logs.getLogger('apps/api/logger', '1.0.0')
  // pino in `multistream` mode hands us each record as an already-serialized
  // JSON string plus a trailing newline. We re-parse so we can preserve the
  // structured shape as OTel LogRecord attributes (and pull out trace_id /
  // span_id that the pino instrumentation mixin already injected).
  return new Writable({
    write(chunk, _enc, cb): void {
      const line = chunk.toString('utf8').trimEnd()
      if (line.length === 0) {
        cb()
        return
      }
      let rec: Record<string, unknown>
      try {
        rec = JSON.parse(line) as Record<string, unknown>
      } catch {
        cb()
        return
      }

      const { level, time, msg, trace_id, span_id, trace_flags, ...attrs } = rec
      const levelNum = typeof level === 'number' ? level : 30
      const severityNumber = PINO_LEVEL_TO_OTEL_SEV[levelNum] ?? SeverityNumber.INFO
      const severityText = PINO_LEVEL_TO_TEXT[levelNum] ?? 'INFO'
      const timestamp = typeof time === 'number' ? time : Date.now()

      otelLogger.emit({
        timestamp,
        severityNumber,
        severityText,
        body: typeof msg === 'string' ? msg : line,
        attributes: {
          ...(typeof trace_id === 'string' ? { trace_id } : {}),
          ...(typeof span_id === 'string' ? { span_id } : {}),
          ...(typeof trace_flags === 'string' ? { trace_flags } : {}),
          ...(attrs as Record<string, unknown>),
        },
      })
      cb()
    },
  })
}

const streamSym = Object.getOwnPropertySymbols(baseLogger).find(
  (s) => s.description === 'pino.stream',
)
if (streamSym) {
  const loggerWithStream = baseLogger as unknown as Record<symbol, unknown>
  const origStream = loggerWithStream[streamSym] as NodeJS.WritableStream
  loggerWithStream[streamSym] = multistream(
    [
      { level: 0, stream: origStream },
      { level: 0, stream: createOtelPinoStream() },
    ],
    { levels: baseLogger.levels.values },
  )
}

export const logger: Logger = baseLogger
