/**
 * Centralized, validated, boot-time-logged config for apps/api.
 *
 * One singleton per process. `process.env` is parsed once through Zod on first
 * import; required vars missing throws immediately with a readable message,
 * and a grouped, masked summary is printed to stdout so what actually booted
 * is visible in logs.
 *
 * Do NOT read `process.env` directly anywhere else in `apps/api/src/**`.
 * Import `config` from this module instead.
 */

import { z } from 'zod'

// Required strings -- fail-fast at boot if missing.
const requiredString = (name: string) =>
  z
    .string({ required_error: `${name} environment variable is required` })
    .min(1, `${name} must not be empty`)

// Optional string with default; also collapses `''` -> default so an explicit
// empty value in .env doesn't slip through as "set".
const optionalStringWithDefault = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : fallback))

const EnvSchema = z.object({
  NODE_ENV: optionalStringWithDefault('development'),

  // HTTP / Fastify runtime
  HTTP_PORT: optionalStringWithDefault('3111'),
  STREAM_PORT: optionalStringWithDefault('3112'),
  DASHBOARD_ORIGIN: optionalStringWithDefault('https://dashboard.example.com'),

  // Convex
  CONVEX_URL: requiredString('CONVEX_URL'),
  CONVEX_DEPLOY_KEY: z.string().optional(),

  // HappyRobot
  HAPPYROBOT_API_KEY: requiredString('HAPPYROBOT_API_KEY'),
  HAPPYROBOT_BASE_URL: optionalStringWithDefault('https://api.happyrobot.ai'),

  // Bridge API security
  BRIDGE_API_KEY: requiredString('BRIDGE_API_KEY'),
  ADMIN_API_KEY: requiredString('ADMIN_API_KEY'),
  // Optional: only consulted when a caller sends `x-webhook-signature`.
  // HappyRobot workflow webhooks can only send static headers, so the
  // common case leaves this unset and relies on `x-api-key` alone.
  WEBHOOK_SECRET: optionalStringWithDefault(''),
  // When true, `/api/v1/offers` rejects a request with 422 if neither
  // `X-Happyrobot-Session-Id` header nor a plausible body `call_id`
  // resolves to a usable correlation id. When false (default), the route
  // still prefers the header but falls back to the body and logs a
  // warning instead of rejecting -- this is the safe rollout posture
  // until every HappyRobot workflow has been updated to send the header.
  STRICT_CALL_ID: optionalStringWithDefault('false'),

  // FMCSA
  FMCSA_WEB_KEY: requiredString('FMCSA_WEB_KEY'),

  // Redis
  REDIS_URL: optionalStringWithDefault('redis://localhost:6379'),

  // Observability
  OTEL_ENABLED: optionalStringWithDefault('true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalStringWithDefault('http://signoz-otel-collector:4318'),
  OTEL_SERVICE_NAME: optionalStringWithDefault('carrier-sales-api'),
  SERVICE_VERSION: optionalStringWithDefault('1.0.0'),
  SERVICE_NAMESPACE: optionalStringWithDefault('development'),
  DEPLOYMENT_REGION: optionalStringWithDefault('local'),
  WIDE_EVENT_SLOW_MS: optionalStringWithDefault('2000'),
  WIDE_EVENT_SUCCESS_SAMPLE_RATE: optionalStringWithDefault('1.0'),
  // When true, an `x-debug: 1|true` request header forces wide-event emission
  // regardless of success sampling. Client-controlled; keep disabled in prod.
  DEBUG_HEADER_ENABLED: optionalStringWithDefault('false'),
})

type Env = z.infer<typeof EnvSchema>

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${details}`)
  }
  return result.data
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function toIntOrFallback(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function toFloatOrFallback(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

const env = parseEnv()

const rawConvexUrl = env.CONVEX_URL
const normalizedConvexUrl = stripTrailingSlash(rawConvexUrl)
const convexUrlWasNormalized = rawConvexUrl !== normalizedConvexUrl

export const config = {
  nodeEnv: env.NODE_ENV,

  http: {
    port: toIntOrFallback(env.HTTP_PORT, 3111),
    streamPort: toIntOrFallback(env.STREAM_PORT, 3112),
    dashboardOrigin: env.DASHBOARD_ORIGIN,
  },

  convex: {
    url: normalizedConvexUrl,
    deployKey: env.CONVEX_DEPLOY_KEY,
  },

  happyrobot: {
    apiKey: env.HAPPYROBOT_API_KEY,
    baseUrl: env.HAPPYROBOT_BASE_URL,
  },

  bridge: {
    apiKey: env.BRIDGE_API_KEY,
    adminKey: env.ADMIN_API_KEY,
    webhookSecret: env.WEBHOOK_SECRET,
    strictCallId: env.STRICT_CALL_ID.toLowerCase() === 'true',
  },

  fmcsa: {
    webKey: env.FMCSA_WEB_KEY,
  },

  redis: {
    url: env.REDIS_URL,
  },

  observability: {
    service: env.OTEL_SERVICE_NAME,
    version: env.SERVICE_VERSION,
    namespace: env.SERVICE_NAMESPACE,
    region: env.DEPLOYMENT_REGION,
    otelEnabled: env.OTEL_ENABLED.toLowerCase() === 'true',
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    slowMs: toIntOrFallback(env.WIDE_EVENT_SLOW_MS, 2000),
    successSampleRate: toFloatOrFallback(env.WIDE_EVENT_SUCCESS_SAMPLE_RATE, 1),
    debugHeaderEnabled: env.DEBUG_HEADER_ENABLED.toLowerCase() === 'true',
  },
} as const

export type Config = typeof config

/** Mask a secret as `*** (len=N, tail=xxxx)`. Empty/undefined -> `<unset>`. */
function maskSecret(value: string | undefined): string {
  if (!value) return '<unset>'
  const tail = value.slice(-Math.min(8, value.length))
  return `*** (len=${value.length}, tail=${tail})`
}

function printBootSummary(): void {
  const lines: string[] = []
  lines.push(`[config] apps/api booted (NODE_ENV=${config.nodeEnv})`)

  const kv = (key: string, val: string) => lines.push(`  ${key.padEnd(32)}= ${val}`)

  kv('http.port', String(config.http.port))
  kv('http.streamPort', String(config.http.streamPort))
  kv('http.dashboardOrigin', config.http.dashboardOrigin)

  kv(
    'convex.url',
    convexUrlWasNormalized
      ? `${config.convex.url}   (normalized from "${rawConvexUrl}")`
      : config.convex.url,
  )
  kv('convex.deployKey', maskSecret(config.convex.deployKey))

  kv('happyrobot.baseUrl', config.happyrobot.baseUrl)
  kv('happyrobot.apiKey', maskSecret(config.happyrobot.apiKey))

  kv('bridge.apiKey', maskSecret(config.bridge.apiKey))
  kv('bridge.adminKey', maskSecret(config.bridge.adminKey))
  kv('bridge.webhookSecret', maskSecret(config.bridge.webhookSecret))
  kv('bridge.strictCallId', String(config.bridge.strictCallId))

  kv('fmcsa.webKey', maskSecret(config.fmcsa.webKey))

  kv('redis.url', config.redis.url)

  kv('observability.service', config.observability.service)
  kv('observability.version', config.observability.version)
  kv('observability.namespace', config.observability.namespace)
  kv('observability.region', config.observability.region)
  kv(
    'observability.otel',
    config.observability.otelEnabled
      ? `enabled (${config.observability.otelEndpoint})`
      : 'disabled',
  )
  kv('observability.slowMs', String(config.observability.slowMs))
  kv('observability.successSampleRate', String(config.observability.successSampleRate))
  kv('observability.debugHeaderEnabled', String(config.observability.debugHeaderEnabled))

  // Single multi-line write keeps the block visually grouped even under
  // concurrent stdout writers (iii workers, OTel logs exporter).
  process.stdout.write(`${lines.join('\n')}\n`)
}

// Top-level side effect: print once on first import. Guarded so HMR / test
// re-imports don't spam.
declare global {
  // eslint-disable-next-line no-var
  var __CARRIER_SALES_CONFIG_PRINTED__: boolean | undefined
}

if (!globalThis.__CARRIER_SALES_CONFIG_PRINTED__) {
  globalThis.__CARRIER_SALES_CONFIG_PRINTED__ = true
  printBootSummary()
}
