import crypto from 'node:crypto'
import { CallWebhookPayloadSchema } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, api } from 'motia'
import { config as appConfig } from '../../config.js'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { webhookReceivedCounter } from '../../observability/metrics.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'

export const config = {
  name: 'CallCompletedWebhook',
  description: 'Receive call completion webhooks from HappyRobot',
  triggers: [
    api('POST', '/api/v1/webhooks/call-completed', {
      bodySchema: CallWebhookPayloadSchema,
      middleware: [apiKeyAuth, wideEventMiddleware],
    }),
  ],
  enqueues: ['call.completed'],
  flows: ['webhook-processing'],
} as const satisfies StepConfig

function verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
  const secret = appConfig.bridge.webhookSecret
  if (!signature) return false

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export const handler: Handlers<typeof config> = async (req, ctx) => {
  try {
    const rawBody = JSON.stringify(req.body)
    const signature = req.headers['x-webhook-signature'] as string | undefined
    const signatureValid = verifyWebhookSignature(rawBody, signature)
    enrichWideEvent(ctx, { signature_valid: signatureValid })

    if (!signatureValid) {
      webhookReceivedCounter.add(1, { signature_valid: 'false' })
      ctx.logger.warn('Invalid webhook signature')
      return {
        status: 401,
        body: {
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          statusCode: 401,
        },
      }
    }

    const parsed = CallWebhookPayloadSchema.safeParse(req.body)
    if (!parsed.success) {
      enrichWideEvent(ctx, { validation_error: parsed.error.message })
      return {
        status: 400,
        body: {
          error: 'Bad Request',
          message: parsed.error.message,
          statusCode: 400,
        },
      }
    }

    enrichWideEvent(ctx, {
      call_id: parsed.data.call_id,
      call_status: parsed.data.status,
      has_transcript: Boolean(parsed.data.transcript),
      carrier_mc: parsed.data.carrier_mc,
      load_id: parsed.data.load_id,
      duration_seconds: parsed.data.duration_seconds,
    })
    webhookReceivedCounter.add(1, { signature_valid: 'true', status: parsed.data.status })

    await ctx.enqueue({ topic: 'call.completed', data: parsed.data })
    enrichWideEvent(ctx, { enqueued: true })

    return { status: 200, body: { received: true } }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'webhook_processing' })
    ctx.logger.error('Webhook processing failed', { error })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Webhook processing failed',
        statusCode: 500,
      },
    }
  }
}
