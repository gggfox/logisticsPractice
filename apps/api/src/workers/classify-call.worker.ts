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
import { type HappyRobotCallRun, getCallRun } from '../services/happyrobot.service.js'

/**
 * Map HR's AI-Classify tag onto our internal `CallOutcome` enum. HR's tag
 * set is fixed by the workflow Classify node (`Success`, `Rate too high`,
 * `Not interested`). Anything unfamiliar returns `undefined` so the
 * keyword-scan fallback runs.
 */
export function outcomeFromHrTag(tag: string | undefined): CallOutcome | undefined {
  if (!tag) return undefined
  const normalized = tag.trim().toLowerCase()
  if (normalized === 'success') return 'booked'
  if (normalized === 'rate too high') return 'declined'
  if (normalized === 'not interested') return 'declined'
  return undefined
}

function classifyOutcome(data: {
  status: string
  transcript?: string
  load_id?: string
  carrier_mc?: string
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
  return 'declined'
}

function stringFromExtraction(
  extraction: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = extraction[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function numberFromExtraction(
  extraction: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = extraction[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export interface BackfilledClassifyInput {
  transcript: string
  speakers: ClassifyCallInput['speakers']
  extraction: Record<string, unknown>
  carrier_mc: string
  load_id: string | undefined
  duration_seconds: number | undefined
  hr_run_fetched: boolean
  hr_classify_tag: string | undefined
  transcript_source: 'webhook' | 'hr_api' | 'none'
}

/**
 * Merge the webhook-side `ClassifyCallInput` with HR's backfilled call-run
 * view. Pure -- no network, no time, no Convex. Exported for unit testing.
 */
export function mergeRunIntoInput(
  data: ClassifyCallInput,
  run: HappyRobotCallRun | null,
): BackfilledClassifyInput {
  const extraction = data.extracted_data ?? run?.extraction ?? {}
  const webhookTranscript =
    typeof data.transcript === 'string' && data.transcript.length > 0 ? data.transcript : undefined
  const runTranscript = run && run.transcript.length > 0 ? run.transcript : undefined
  const transcript = webhookTranscript ?? runTranscript ?? ''
  let transcript_source: BackfilledClassifyInput['transcript_source'] = 'none'
  if (webhookTranscript) transcript_source = 'webhook'
  else if (runTranscript) transcript_source = 'hr_api'

  const speakers = data.speakers?.length ? data.speakers : run?.speakers

  const extractionMc =
    stringFromExtraction(extraction, 'carrier_mc') ?? stringFromExtraction(extraction, 'mc_number')
  const carrier_mc = data.carrier_mc ?? extractionMc ?? 'unknown'

  const load_id = data.load_id ?? stringFromExtraction(extraction, 'reference_number')

  const duration_seconds =
    data.duration_seconds ??
    run?.duration_seconds ??
    numberFromExtraction(extraction, 'call_duration_seconds')

  return {
    transcript,
    speakers,
    extraction,
    carrier_mc,
    load_id,
    duration_seconds,
    hr_run_fetched: run !== null,
    hr_classify_tag: run?.classification?.tag,
    transcript_source,
  }
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
          // Fetch the full HR run so we can backfill transcript, extraction,
          // and AI-Classify tag that the `session.status_changed` envelope
          // never carries. Swallow errors: classify must still write a row
          // even if HR is down.
          const run =
            data.call_id === 'unknown'
              ? null
              : await getCallRun(data.call_id).catch((err) => {
                  logger.warn({ call_id: data.call_id, err }, 'happyrobot getCallRun failed')
                  return null
                })

          const merged = mergeRunIntoInput(data, run)

          enrich({
            call_id: data.call_id,
            carrier_mc: merged.carrier_mc,
            load_id: merged.load_id,
            call_status: data.status,
            transcript_length: merged.transcript.length,
            duration_seconds: merged.duration_seconds,
            hr_run_fetched: merged.hr_run_fetched,
            hr_classify_tag: merged.hr_classify_tag,
            transcript_source: merged.transcript_source,
          })

          // Prefer HR's AI-Classify tag; fall back to the keyword scan when
          // the tag is absent or unrecognized.
          const outcome =
            outcomeFromHrTag(merged.hr_classify_tag) ??
            classifyOutcome({
              status: data.status,
              transcript: merged.transcript,
              load_id: merged.load_id,
              carrier_mc: merged.carrier_mc === 'unknown' ? undefined : merged.carrier_mc,
            })

          const negotiations = await convexService.negotiations.getByCallId(data.call_id)
          const finalNeg = negotiations[negotiations.length - 1]
          const negotiatedRate = finalNeg?.accepted ? finalNeg.offered_rate : undefined
          const extractionFinalRate = numberFromExtraction(merged.extraction, 'final_rate')
          const final_rate = negotiatedRate ?? extractionFinalRate

          await convexService.calls.create({
            call_id: data.call_id,
            carrier_mc: merged.carrier_mc,
            load_id: merged.load_id,
            transcript: merged.transcript,
            speakers: merged.speakers,
            outcome,
            negotiation_rounds: negotiations.length,
            final_rate,
            started_at: data.started_at,
            ended_at: data.ended_at,
            duration_seconds: merged.duration_seconds,
          })

          callOutcomeCounter.add(1, { outcome })
          enrich({
            outcome,
            negotiation_rounds: negotiations.length,
            final_rate,
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
