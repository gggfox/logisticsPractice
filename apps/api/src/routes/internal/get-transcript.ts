import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { getCallTranscript } from '../../services/happyrobot.service.js'
import { ErrorBodySchema } from '../_error-schema.js'

const ParamsSchema = z.object({
  call_id: z.string().min(1),
})

const TranscriptResponseSchema = z.object({
  transcript: z.string(),
  speakers: z.array(z.object({ role: z.string(), text: z.string() })),
})

const getTranscriptRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/calls/:call_id/transcript',
    {
      schema: {
        tags: ['calls'],
        summary: 'Fetch transcript for a completed call',
        description: 'Proxies HappyRobot to return the transcript and speaker turns for a call_id.',
        params: ParamsSchema,
        response: {
          200: TranscriptResponseSchema,
          404: ErrorBodySchema,
          500: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const { call_id } = req.params
      enrichWideEvent(req, { call_id })

      try {
        const transcript = await getCallTranscript(call_id)
        if (transcript === null) {
          enrichWideEvent(req, { transcript_found: false })
          return reply.code(404).send({
            error: 'Not Found',
            message: `Transcript for call ${call_id} not found`,
            statusCode: 404,
          })
        }
        enrichWideEvent(req, {
          transcript_found: true,
          transcript_length: transcript.transcript.length,
        })
        return transcript
      } catch (err) {
        enrichWideEvent(req, { failure_stage: 'happyrobot_api' })
        req.log.error({ err, call_id }, 'Failed to fetch transcript')
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch transcript',
          statusCode: 500,
        })
      }
    },
  )
}

export default getTranscriptRoute
