import type { CallOutcome } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, queue } from 'motia'
import { z } from 'zod'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'ClassifyCall',
  description: 'Classify call outcome based on conversation data',
  triggers: [
    queue('call.completed', {
      input: z.object({
        call_id: z.string(),
        carrier_mc: z.string().optional(),
        load_id: z.string().optional(),
        transcript: z.string().optional(),
        duration_seconds: z.number().optional(),
        started_at: z.string(),
        ended_at: z.string(),
        status: z.string(),
        extracted_data: z.record(z.unknown()).optional(),
      }),
    }),
  ],
  flows: ['webhook-processing'],
} as const satisfies StepConfig

function classifyOutcome(data: {
  status: string
  load_id?: string
  carrier_mc?: string
  transcript?: string
  extracted_data?: Record<string, unknown>
}): CallOutcome {
  const transcript = (data.transcript ?? '').toLowerCase()

  if (transcript.includes('transfer') || data.status === 'transferred') {
    return 'transferred'
  }
  if (
    transcript.includes('accepted') ||
    transcript.includes('booked') ||
    transcript.includes("let's do it")
  ) {
    return 'booked'
  }
  if (!data.load_id && !data.carrier_mc) {
    return 'dropped'
  }
  if (!data.load_id) {
    return 'no_match'
  }
  if (
    transcript.includes('not interested') ||
    transcript.includes('too low') ||
    transcript.includes('no thanks')
  ) {
    return 'declined'
  }
  return 'declined'
}

export const handler: Handlers<typeof config> = {
  async queue(data, { logger }) {
    logger.info('Classifying call', { call_id: data.call_id })

    const outcome = classifyOutcome(data)

    const negotiations = await convexService.negotiations.getByCallId(data.call_id)
    const finalNeg = negotiations[negotiations.length - 1]

    await convexService.calls.create({
      call_id: data.call_id,
      carrier_mc: data.carrier_mc ?? 'unknown',
      load_id: data.load_id,
      transcript: data.transcript ?? '',
      outcome,
      negotiation_rounds: negotiations.length,
      final_rate: finalNeg?.accepted ? finalNeg.offered_rate : undefined,
      started_at: data.started_at,
      ended_at: data.ended_at,
      duration_seconds: data.duration_seconds,
    })

    logger.info('Call classified', { call_id: data.call_id, outcome })
  },
}
