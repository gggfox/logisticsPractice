import type { CallOutcome } from '@carrier-sales/shared'
import { Worker } from 'bullmq'
import { logger } from '../logger.js'
import { callOutcomeCounter } from '../observability/metrics.js'
import { withWideEvent } from '../observability/wide-event.js'
import {
  type ClassifyCallInput,
  ClassifyCallInputSchema,
  QUEUE_NAMES,
  getRedisConnection,
} from '../queues/index.js'
import { convexService } from '../services/convex.service.js'

function classifyOutcome(data: ClassifyCallInput): CallOutcome {
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
  return 'declined'
}

export function createClassifyCallWorker(): Worker<ClassifyCallInput> {
  const worker = new Worker<ClassifyCallInput>(
    QUEUE_NAMES.classifyCall,
    async (job) => {
      const data = ClassifyCallInputSchema.parse(job.data)

      await withWideEvent(
        'ClassifyCall',
        { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.classifyCall } },
        async (enrich) => {
          enrich({
            call_id: data.call_id,
            carrier_mc: data.carrier_mc,
            load_id: data.load_id,
            call_status: data.status,
            transcript_length: data.transcript?.length ?? 0,
            duration_seconds: data.duration_seconds,
          })

          const outcome = classifyOutcome(data)

          const negotiations = await convexService.negotiations.getByCallId(data.call_id)
          const finalNeg = negotiations[negotiations.length - 1]
          const finalRate = finalNeg?.accepted ? finalNeg.offered_rate : undefined

          await convexService.calls.create({
            call_id: data.call_id,
            carrier_mc: data.carrier_mc ?? 'unknown',
            load_id: data.load_id,
            transcript: data.transcript ?? '',
            outcome,
            negotiation_rounds: negotiations.length,
            final_rate: finalRate,
            started_at: data.started_at,
            ended_at: data.ended_at,
            duration_seconds: data.duration_seconds,
          })

          callOutcomeCounter.add(1, { outcome })
          enrich({
            outcome,
            negotiation_rounds: negotiations.length,
            final_rate: finalRate,
          })
        },
      )
    },
    { connection: getRedisConnection() },
  )

  worker.on('failed', (job, err) => {
    logger.error(
      { job_id: job?.id, queue: QUEUE_NAMES.classifyCall, err },
      'classify-call worker job failed',
    )
  })

  return worker
}
