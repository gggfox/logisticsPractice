/**
 * Process-wide pino logger.
 *
 * Fastify uses its own `req.log` (wired in `server.ts`), which pino
 * instrumentation auto-injects `trace_id` / `span_id` into. For standalone
 * code paths (BullMQ workers, cron handlers, top-level boot) import this
 * singleton directly.
 *
 * In development we render pretty logs to stdout; in production we emit
 * newline-delimited JSON so SigNoz's log collector can parse fields.
 */

import { type Logger, pino } from 'pino'
import { config } from './config.js'

const isDev = config.nodeEnv !== 'production'

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: {
    service: config.observability.service,
    service_version: config.observability.version,
    service_namespace: config.observability.namespace,
    deployment_region: config.observability.region,
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }
    : {}),
})
