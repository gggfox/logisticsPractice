import crypto from 'node:crypto'
import { CallWebhookPayloadSchema } from '@carrier-sales/shared'
import { http, type Handlers, type StepConfig } from 'motia'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'

export const config = {
  name: 'CallCompletedWebhook',
  description: 'Receive call completion webhooks from HappyRobot',
  triggers: [
    http('POST', '/api/v1/webhooks/call-completed', {
      bodySchema: CallWebhookPayloadSchema,
      middleware: [apiKeyAuth],
    }),
  ],
  enqueues: ['call.completed'],
  flows: ['webhook-processing'],
} as const satisfies StepConfig

function verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret || !signature) return !secret

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger, enqueue }) {
    try {
      const rawBody = JSON.stringify(req.body)
      const signature = req.headers['x-webhook-signature'] as string | undefined

      if (!verifyWebhookSignature(rawBody, signature)) {
        logger.warn('Invalid webhook signature')
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          statusCode: 401,
        })
      }

      const parsed = CallWebhookPayloadSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Bad Request',
          message: parsed.error.message,
          statusCode: 400,
        })
      }

      logger.info('Call completed webhook received', { call_id: parsed.data.call_id })

      await enqueue('call.completed', parsed.data)

      return res.status(200).json({ received: true })
    } catch (error) {
      logger.error('Webhook processing failed', { error })
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Webhook processing failed',
        statusCode: 500,
      })
    }
  },
}
