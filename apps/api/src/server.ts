/**
 * Fastify entrypoint.
 *
 * IMPORTANT: `./otel.js` is imported FIRST so the auto-instrumentations
 * patch the modules every other file is about to import. Swapping the
 * order means spans disappear.
 *
 * The process hosts four independently-drained surfaces:
 *  1. Fastify HTTP server (plugins + routes)
 *  2. BullMQ workers (registered in commit 6)
 *  3. Croner cron jobs (registered in commit 6)
 *  4. Shared ioredis connection (closed last)
 *
 * Graceful shutdown handles SIGTERM (Dokploy stop) and SIGINT (Ctrl-C).
 * Each surface gets a bounded wait so a hung external call cannot block
 * container rotation indefinitely.
 */

// otel.js must be the first import so NodeSDK.start() runs before
// Fastify / ioredis / pino are evaluated. ESM imports hoist but execute
// in source order, so leaving this at the top is load-bearing.
import { shutdownOtel } from './otel.js'

import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyError } from 'fastify'
import rawBody from 'fastify-raw-body'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { config } from './config.js'
import {
  startAggregateMetricsCron,
  stopAggregateMetricsCron,
} from './cron/aggregate-metrics.cron.js'
import { logger } from './logger.js'
import apiKeyAuth from './plugins/api-key-auth.js'
import rateLimiter from './plugins/rate-limiter.js'
import securityHeaders from './plugins/security-headers.js'
import wideEvent from './plugins/wide-event.js'
import { closeAllQueues, closeRedisConnection } from './queues/index.js'
import routes from './routes/index.js'
import { startWorkers, stopWorkers } from './workers/index.js'

export async function buildServer() {
  const app = Fastify({
    // Reuse the app-wide pino instance so workers / routes share one
    // formatter and the OTel pino instrumentation only patches once.
    loggerInstance: logger,
    disableRequestLogging: false,
    bodyLimit: 1_048_576, // 1 MiB -- webhooks and offers are tiny.
    trustProxy: true, // behind Traefik
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(sensible)
  await app.register(cors, {
    origin: [config.http.dashboardOrigin, 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'x-webhook-signature', 'x-debug'],
  })
  await app.register(rawBody, {
    field: 'rawBody',
    global: false, // opt in per-route (webhooks only)
    encoding: 'utf8',
    runFirst: true,
  })

  // Plugin order matters: security-headers first (applies to 4xx/429/5xx),
  // rate-limiter before auth so unauth'd traffic still consumes budget,
  // wide-event last so it observes the final status code.
  await app.register(securityHeaders)
  await app.register(rateLimiter)
  await app.register(apiKeyAuth)
  await app.register(wideEvent)

  // OpenAPI spec + Swagger UI. Registered after api-key-auth so the
  // /docs and /docs/json routes inherit the same auth preHandler;
  // the auth plugin accepts an `?api_key=` query fallback scoped to
  // /docs/** so a browser can load the UI without custom headers.
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Carrier Sales Bridge API',
        version: config.observability.version,
        description:
          'Fastify bridge between HappyRobot voice agents and Convex. All /api/v1 routes require an `x-api-key` header.',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
          webhookSignature: {
            type: 'apiKey',
            in: 'header',
            name: 'x-webhook-signature',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
    transform: jsonSchemaTransform,
  })

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { persistAuthorization: true, docExpansion: 'list' },
    staticCSP: true,
  })

  await app.register(routes)

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    // Fastify's default handler logs at error level with statusCode; we
    // rely on the wide-event plugin's onError to emit the structured log.
    // Keep the reply body in the project's `{ error, message, statusCode }`
    // shape.
    const statusCode = err.statusCode ?? 500
    reply.code(statusCode).send({
      error: err.name ?? 'Internal Server Error',
      message: err.message ?? 'Unhandled error',
      statusCode,
    })
  })

  return app
}

type ShutdownHook = () => Promise<void>
const shutdownHooks: ShutdownHook[] = []

export function registerShutdownHook(hook: ShutdownHook): void {
  shutdownHooks.push(hook)
}

type BuiltServer = Awaited<ReturnType<typeof buildServer>>

async function shutdown(app: BuiltServer, signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown: starting')
  try {
    await app.close()
    for (const hook of shutdownHooks) {
      await hook().catch((hookErr: unknown) =>
        logger.error({ err: hookErr }, 'shutdown hook failed'),
      )
    }
    stopAggregateMetricsCron()
    await stopWorkers()
    await closeAllQueues()
    await closeRedisConnection()
    await shutdownOtel()
    logger.info({ signal }, 'shutdown: complete')
    process.exit(0)
  } catch (err: unknown) {
    logger.error({ err }, 'shutdown: failed')
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const app = await buildServer()

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(app, signal)
    })
  }

  startWorkers()
  startAggregateMetricsCron()

  await app.listen({ port: config.http.port, host: '0.0.0.0' })
  logger.info({ port: config.http.port }, 'api: listening')
}

// `tsx` and `node` both set the ESM main module's `import.meta.url` to the
// file URL of this file when executed directly, so this guard lets us
// import `buildServer` in tests without booting the server.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  try {
    await main()
  } catch (err: unknown) {
    logger.error({ err }, 'api: boot failed')
    process.exit(1)
  }
}
