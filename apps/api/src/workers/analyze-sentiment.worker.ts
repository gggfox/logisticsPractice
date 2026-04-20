import type { Sentiment } from '@carrier-sales/shared'
import { Worker } from 'bullmq'
import { logger } from '../logger.js'
import { sentimentCounter } from '../observability/metrics.js'
import { withWideEvent } from '../observability/wide-event.js'
import {
  type AnalyzeSentimentInput,
  AnalyzeSentimentInputSchema,
  QUEUE_NAMES,
  getRedisConnection,
} from '../queues/index.js'
import { convexService } from '../services/convex.service.js'
import { getRun } from '../services/happyrobot.service.js'

const SENTIMENT_SIGNALS: Record<Sentiment, string[]> = {
  positive: [
    'sounds good',
    'sounds great',
    "let's do it",
    'perfect',
    'deal',
    'i accept',
    'we can do that',
    'happy to',
    'appreciate',
    'thanks',
    'excellent',
    'works for me',
  ],
  negative: [
    'not interested',
    'too low',
    'no thanks',
    'pass on',
    "can't do",
    'way too',
    'not worth',
    'below market',
    'lowball',
  ],
  frustrated: [
    'ridiculous',
    'waste of time',
    'insane',
    'you kidding',
    'joke',
    'terrible',
    'worst',
    'absurd',
    'never',
    'unacceptable',
    'come on',
  ],
  neutral: [],
}

function analyzeSentiment(transcript: string): { sentiment: Sentiment; confidence: number } {
  const lower = transcript.toLowerCase()
  const scores: Record<Sentiment, number> = {
    positive: 0,
    negative: 0,
    frustrated: 0,
    neutral: 0,
  }

  for (const [sentiment, signals] of Object.entries(SENTIMENT_SIGNALS)) {
    for (const signal of signals) {
      if (lower.includes(signal)) {
        scores[sentiment as Sentiment] += 1
      }
    }
  }

  const totalSignals = Object.values(scores).reduce((a, b) => a + b, 0)
  if (totalSignals === 0) return { sentiment: 'neutral', confidence: 0.5 }

  const entries = Object.entries(scores) as [Sentiment, number][]
  entries.sort((a, b) => b[1] - a[1])
  const [topSentiment, topScore] = entries[0] ?? (['neutral', 0] as [Sentiment, number])

  return {
    sentiment: topSentiment,
    confidence: Math.min(0.95, topScore / totalSignals),
  }
}

/**
 * Resolve the transcript for a sentiment job, preferring the webhook payload
 * and falling back to `GET /api/v1/runs/:run_id` on HappyRobot. `source`
 * is reported on the wide event so the "no transcript" skip is debuggable.
 *
 * The HR lookup is keyed by `run_id` (what the platform API actually
 * accepts), not `call_id` / `session_id`; when `run_id` is absent we
 * skip the lookup and emit `source: 'none'`.
 */
async function resolveSentimentTranscript(data: AnalyzeSentimentInput): Promise<{
  transcript: string
  source: 'webhook' | 'hr_api' | 'none'
}> {
  if (data.transcript && data.transcript.length > 0) {
    return { transcript: data.transcript, source: 'webhook' }
  }
  if (data.run_id === undefined) {
    return { transcript: '', source: 'none' }
  }
  const run = await getRun(data.run_id).catch((err) => {
    logger.warn(
      { run_id: data.run_id, call_id: data.call_id, err },
      'happyrobot getRun failed in sentiment worker',
    )
    return null
  })
  if (run && run.transcript.length > 0) {
    return { transcript: run.transcript, source: 'hr_api' }
  }
  return { transcript: '', source: 'none' }
}

export function createAnalyzeSentimentWorker(): Worker<AnalyzeSentimentInput> {
  const worker = new Worker<AnalyzeSentimentInput>(
    QUEUE_NAMES.analyzeSentiment,
    async (job) => {
      const data = AnalyzeSentimentInputSchema.parse(job.data)

      await withWideEvent(
        'AnalyzeSentiment',
        { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.analyzeSentiment } },
        async (enrich) => {
          const { transcript, source: transcript_source } = await resolveSentimentTranscript(data)

          enrich({
            call_id: data.call_id,
            had_transcript: transcript.length > 0,
            transcript_length: transcript.length,
            transcript_source,
          })

          if (!transcript) {
            // Don't stamp `neutral` on content-less rows; classify will
            // still write the row with `outcome: 'dropped'`.
            enrich({ skipped: true, skip_reason: 'no_transcript' })
            return
          }

          const { sentiment, confidence } = analyzeSentiment(transcript)

          // Patch sentiment only. The classify worker owns `outcome`;
          // when this worker lands second (or first), never overwrite it.
          await convexService.calls.updateSentiment({
            call_id: data.call_id,
            sentiment,
          })

          sentimentCounter.add(1, { sentiment })
          enrich({ sentiment, confidence })
        },
      )
    },
    { connection: getRedisConnection() },
  )

  worker.on('failed', (job, err) => {
    logger.error(
      { job_id: job?.id, queue: QUEUE_NAMES.analyzeSentiment, err },
      'analyze-sentiment worker job failed',
    )
  })

  return worker
}
