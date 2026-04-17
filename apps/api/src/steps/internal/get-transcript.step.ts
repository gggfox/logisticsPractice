import { type Handlers, type StepConfig, api } from 'motia'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { getCallTranscript } from '../../services/happyrobot.service.js'

export const config = {
  name: 'GetCallTranscript',
  description: 'Fetch call transcript from HappyRobot API',
  triggers: [
    api('GET', '/api/v1/calls/:call_id/transcript', {
      middleware: [apiKeyAuth, wideEventMiddleware],
    }),
  ],
  flows: ['internal-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  const { call_id } = req.pathParams as { call_id: string }
  enrichWideEvent(ctx, { call_id })

  try {
    const transcript = await getCallTranscript(call_id)
    const body = typeof transcript === 'string' ? transcript : JSON.stringify(transcript)
    enrichWideEvent(ctx, { transcript_length: body.length })
    return { status: 200, body: transcript }
  } catch (error) {
    enrichWideEvent(ctx, { failure_stage: 'happyrobot_api' })
    ctx.logger.error('Failed to fetch transcript', { call_id, error })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to fetch transcript',
        statusCode: 500,
      },
    }
  }
}
