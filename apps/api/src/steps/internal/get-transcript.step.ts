import { http, type Handlers, type StepConfig } from 'motia'
import { apiKeyAuth } from '../../middleware/api-key-auth.js'
import { getCallTranscript } from '../../services/happyrobot.service.js'

export const config = {
  name: 'GetCallTranscript',
  description: 'Fetch call transcript from HappyRobot API',
  triggers: [
    http('GET', '/api/v1/calls/:call_id/transcript', {
      middleware: [apiKeyAuth],
    }),
  ],
  flows: ['internal-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger }) {
    try {
      const { call_id } = req.params as { call_id: string }
      logger.info('Fetching transcript', { call_id })

      const transcript = await getCallTranscript(call_id)
      return res.status(200).json(transcript)
    } catch (error) {
      logger.error('Failed to fetch transcript', { error })
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch transcript',
        statusCode: 500,
      })
    }
  },
}
