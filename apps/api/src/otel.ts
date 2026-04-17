/**
 * OpenTelemetry Node SDK bootstrap.
 *
 * Must be imported before any other instrumented module (fastify, bullmq,
 * ioredis, pino, outgoing fetch) -- the first line of `src/server.ts` is
 * `import './otel.js'`. Importing later means the auto-instrumentations
 * patch a copy of the module that nobody uses and traces come out empty.
 *
 * Exports a `shutdownOtel()` used by the server's SIGTERM/SIGINT handler so
 * the last batch of spans/metrics/logs is flushed before the process exits.
 *
 * Endpoint: OTLP-HTTP expects `:4318` (not the gRPC `:4317`). The three
 * exporters append `/v1/traces`, `/v1/metrics`, `/v1/logs` to the base URL
 * automatically.
 */

import { BullMQInstrumentation } from '@appsignal/opentelemetry-instrumentation-bullmq'
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, type LogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { config } from './config.js'

let sdk: NodeSDK | null = null

function buildSdk(): NodeSDK {
  const base = config.observability.otelEndpoint

  const traceExporter = new OTLPTraceExporter({ url: `${base}/v1/traces` })
  const metricExporter = new OTLPMetricExporter({ url: `${base}/v1/metrics` })
  const logExporter = new OTLPLogExporter({ url: `${base}/v1/logs` })

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 30_000,
  })

  const logRecordProcessors: LogRecordProcessor[] = [new BatchLogRecordProcessor(logExporter)]

  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.observability.service,
      [ATTR_SERVICE_VERSION]: config.observability.version,
      'service.namespace': config.observability.namespace,
      'deployment.environment': config.observability.namespace,
      'deployment.region': config.observability.region,
    }),
    traceExporter,
    metricReader,
    logRecordProcessors,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Pino shipped as a separate bundle below to pick up the trace
        // context injector explicitly; disable the auto copy to avoid
        // double-instrumenting.
        '@opentelemetry/instrumentation-pino': { enabled: false },
        // The filesystem instrumentation is chatty and rarely useful.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
      new PinoInstrumentation(),
      new BullMQInstrumentation(),
    ],
  })
}

if (config.observability.otelEnabled) {
  // Route OTel SDK diagnostics through console at WARN level so exporter
  // failures (e.g. collector unreachable) surface without flooding INFO.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)
  sdk = buildSdk()
  sdk.start()
}

export async function shutdownOtel(): Promise<void> {
  if (!sdk) return
  try {
    await sdk.shutdown()
  } catch (err) {
    // Never let a broken exporter block process exit.
    // eslint-disable-next-line no-console
    console.error('[otel] shutdown failed', err)
  }
}
