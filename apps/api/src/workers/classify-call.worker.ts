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
import { isValidMcFormat } from '../routes/webhooks/validation.js'
import { attemptBookLoad } from '../services/book-load.service.js'
import { convexService } from '../services/convex.service.js'
import { type HappyRobotCallRun, getRun } from '../services/happyrobot.service.js'

/**
 * Fields that are safe to send to `calls.create` even when the Convex
 * validator is lagging the API deployment. Kept in sync with the
 * original `packages/convex/convex/calls.ts` contract -- anything added
 * after this comment is a diagnostic / future field and must go on the
 * second-chance shape in `createCallWithFallback` so schema drift never
 * drops a call row.
 */
type CallsCreateInput = Parameters<typeof convexService.calls.create>[0]

export function stripDiagnosticFields(input: CallsCreateInput): CallsCreateInput {
  const { run_id: _run_id, hr_run_fetched: _hr_run_fetched, ...base } = input
  return base
}

/**
 * Create the call row, falling back to the pre-diagnostic-fields shape
 * if the deployed Convex validator rejects a field the app is sending.
 * Convex's deployed functions can lag the API (Dokploy auto-deploys the
 * API; Convex only redeploys via `pnpm -F @carrier-sales/convex deploy`
 * or the CI job in `.github/workflows/ci.yml`). On drift the full
 * shape fails with `ArgumentValidationError`; the fallback guarantees
 * the dashboard never silently loses a call row.
 */
async function createCallWithFallback(
  input: CallsCreateInput,
  {
    enrich,
    runId,
  }: { enrich: (fields: Record<string, unknown>) => void; runId: string | undefined },
): Promise<{ fellBack: boolean }> {
  try {
    await convexService.calls.create(input)
    return { fellBack: false }
  } catch (err) {
    enrich({
      convex_create_fallback: true,
      convex_create_first_error: err instanceof Error ? err.message : String(err),
    })
    logger.warn(
      { err, call_id: input.call_id, run_id: runId },
      'calls.create failed with extended shape; retrying without diagnostic fields',
    )
    await convexService.calls.create(stripDiagnosticFields(input))
    return { fellBack: true }
  }
}

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
 * A merged classify input is "ready" when we have enough business data to
 * write a meaningful `calls` row -- `carrier_mc` and `load_id` identified
 * from SOME source. When it's not ready we'd rather retry than write a row
 * with `carrier_mc: 'unknown'` + `load_id: undefined` that silently
 * masquerades as a real failure-to-book.
 *
 * Two readiness paths, in priority order:
 *
 *   1. Webhook alone already carries both IDs -- skip the HR backfill
 *      wait. The templated per-node webhook (docs §9.1) delivers
 *      `carrier_mc` + `load_id` directly, so gating on `hr_run_fetched`
 *      here would drop every workflow whose template omits `run_id`.
 *   2. Otherwise require HR backfill, then accept either ID. This is
 *      the original pre-templated-webhook posture kept for the
 *      envelope-only delivery path (`session.status_changed`).
 */
export function isClassifyInputReady(merged: BackfilledClassifyInput): boolean {
  const hasCarrier = merged.carrier_mc !== 'unknown'
  const hasLoad = merged.load_id !== undefined
  if (hasCarrier && hasLoad) return true
  if (!merged.hr_run_fetched) return false
  return hasCarrier || hasLoad
}

/**
 * Collapse the three `outcome` signals into the final `CallOutcome`.
 * Pure so the classify worker body stays under the sonarqube cognitive
 * complexity cap. Priority order matches the source reliability:
 *   1. `dropped` on the final attempt when extraction never arrived.
 *   2. HR's AI-Extract `booking_decision: "yes"`.
 *   3. HR's AI-Classify tag (`Success`/`Rate too high`/`Not interested`).
 *   4. Keyword scan on the webhook transcript.
 */
export function resolveOutcome(args: {
  ready: boolean
  isFinalAttempt: boolean
  booking_decision: 'yes' | 'no' | undefined
  hr_classify_tag: string | undefined
  status: string
  transcript: string
  load_id: string | undefined
  carrier_mc: string
}): CallOutcome {
  if (!args.ready && args.isFinalAttempt) return 'dropped'
  if (args.booking_decision === 'yes') return 'booked'
  const fromTag = outcomeFromHrTag(args.hr_classify_tag)
  if (fromTag) return fromTag
  return classifyOutcome({
    status: args.status,
    transcript: args.transcript,
    load_id: args.load_id,
    carrier_mc: args.carrier_mc === 'unknown' ? undefined : args.carrier_mc,
  })
}

type Enrich = (fields: Record<string, unknown>) => void

/**
 * One indexed Convex query: `true` only when the load row exists. Treats
 * Convex errors as `false` so a transient outage can't spuriously flip a
 * non-existent load to `booked`; the error is still recorded on the wide
 * event for follow-up.
 */
async function checkLoadExists(
  load_id: string | undefined,
  { callId, enrich }: { callId: string; enrich: Enrich },
): Promise<boolean> {
  if (load_id === undefined) return false
  try {
    const load = await convexService.loads.getByLoadId(load_id)
    return load !== null
  } catch (err) {
    logger.warn(
      { err, call_id: callId, load_id },
      'classify: loads.getByLoadId validation lookup failed',
    )
    enrich({ load_lookup_error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

async function updateLoadStatusBooked(
  load_id: string,
  { callId, enrich }: { callId: string; enrich: Enrich },
): Promise<boolean> {
  try {
    await convexService.loads.updateStatus(load_id, 'booked')
    return true
  } catch (err) {
    logger.warn({ err, call_id: callId, load_id }, 'classify: loads.updateStatus(booked) failed')
    enrich({ load_status_update_error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

interface WriteClassifyResult {
  fellBack: boolean
  load_status_updated: boolean
  auto_book_attempted: boolean
  auto_book_reason?: string
}

/**
 * Two write paths, selected by the authoritative-book gate in the caller:
 *
 *   - `authoritative_book = true`: same contract as `POST
 *     /api/v1/loads/:load_id/book`. Routes through the shared
 *     `attemptBookLoad` service so the guards (load state, rate
 *     bounds) are identical across the HTTP book_load tool and this
 *     post-webhook auto-book path. On any service-level rejection we
 *     fall through to `createCallWithFallback` so the call row still
 *     lands with the classify-determined outcome -- we just don't
 *     flip the load.
 *
 *   - otherwise: existing `createCallWithFallback` path. If the outcome
 *     still says `booked` (e.g. HR Classify tag `Success`) AND the load
 *     exists, we still mirror to the load status so the load-board
 *     doesn't go stale -- better than a silently-available load that
 *     just got booked.
 */
async function writeClassifyResult(args: {
  data: ClassifyCallInput
  merged: BackfilledClassifyInput
  outcome: CallOutcome
  final_rate: number | undefined
  negotiations_count: number
  authoritative_book: boolean
  load_exists: boolean
  enrich: Enrich
}): Promise<WriteClassifyResult> {
  const { data, merged, outcome, final_rate, negotiations_count, enrich } = args

  if (args.authoritative_book && merged.load_id !== undefined && final_rate !== undefined) {
    const bookResult = await attemptBookLoad({
      call_id: data.call_id,
      load_id: merged.load_id,
      carrier_mc: merged.carrier_mc,
      agreed_rate: final_rate,
      started_at: data.started_at,
      ended_at: data.ended_at,
    })

    if (bookResult.booked) {
      enrich({
        auto_book_attempted: true,
        loadboard_rate: bookResult.loadboard_rate,
        discount_percent: bookResult.discount_percent,
      })
      return {
        fellBack: false,
        load_status_updated: bookResult.load_status_updated,
        auto_book_attempted: true,
      }
    }

    // `attemptBookLoad` rejected. `already_booked` is the idempotent
    // case -- a prior webhook / `/api/v1/offers` already flipped this
    // load, so we still report the load as booked from our POV and
    // write the call row via the fallback path to capture transcript /
    // outcome / sentiment details. The other failure reasons (load not
    // found, rate out of bounds, wrong state) need the call row too,
    // with a surfaced `auto_book_reason` for SigNoz so operators can
    // see why the auto-book was declined.
    enrich({
      auto_book_attempted: true,
      auto_book_reason: bookResult.reason,
      ...('loadboard_rate' in bookResult ? { loadboard_rate: bookResult.loadboard_rate } : {}),
      ...('min_acceptable_rate' in bookResult
        ? { min_acceptable_rate: bookResult.min_acceptable_rate }
        : {}),
    })
    if (bookResult.reason !== 'already_booked') {
      logger.warn(
        {
          call_id: data.call_id,
          load_id: merged.load_id,
          final_rate,
          reason: bookResult.reason,
        },
        'classify: auto-book rejected by shared book-load guards',
      )
    }
  }

  const result = await createCallWithFallback(
    {
      call_id: data.call_id,
      carrier_mc: merged.carrier_mc,
      load_id: merged.load_id,
      transcript: merged.transcript,
      speakers: merged.speakers,
      outcome,
      negotiation_rounds: negotiations_count,
      final_rate,
      started_at: data.started_at,
      ended_at: data.ended_at,
      duration_seconds: merged.duration_seconds,
      // Persist the exact HR identifiers + backfill outcome so prod
      // failures are debuggable via `npx convex run calls:getByCallId`
      // alone -- without requiring SigNoz UI or Dokploy log access.
      run_id: data.run_id,
      hr_run_fetched: merged.hr_run_fetched,
    },
    { enrich, runId: data.run_id },
  )

  let load_status_updated = false
  if (outcome === 'booked' && args.load_exists && merged.load_id !== undefined) {
    load_status_updated = await updateLoadStatusBooked(merged.load_id, {
      callId: data.call_id,
      enrich,
    })
  }
  return {
    fellBack: result.fellBack,
    load_status_updated,
    auto_book_attempted: args.authoritative_book,
  }
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

  // HR's AI Classify tag can reach us from two sources: the runs-API
  // response (`run.classification.tag`), or the per-node templated
  // webhook body (`data.classification_tag`). Prefer the runs-API
  // value because it's the canonical post-call output; the webhook
  // body is only populated when the HR workflow templates include
  // `classification.tag` explicitly. Either is strictly better than
  // running the transcript keyword scan against an empty string.
  const hr_classify_tag = run?.classification?.tag ?? data.classification_tag

  return {
    transcript,
    speakers,
    extraction,
    carrier_mc,
    load_id,
    duration_seconds,
    hr_run_fetched: run !== null,
    hr_classify_tag,
    transcript_source,
  }
}

/**
 * Single classify attempt: backfill from HR, validate, classify, write.
 * Extracted so the BullMQ wrapper stays under the biome cognitive
 * complexity cap while still doing one logical thing.
 */
async function runClassifyJob(
  data: ClassifyCallInput,
  ctx: { attemptsMade: number; maxAttempts: number },
  enrich: Enrich,
): Promise<void> {
  const { attemptsMade, maxAttempts } = ctx
  const isFinalAttempt = attemptsMade + 1 >= maxAttempts

  // Fetch the full HR run so we can backfill transcript, extraction,
  // and AI-Classify tag that the `session.status_changed` envelope
  // never carries. Swallow errors: classify must still write a row
  // even if HR is down.
  //
  // HR's `/api/v1/runs/:run_id` is keyed by `run_id`. For the inbound
  // Web-call workflow the `session_id` we store as `call_id` happens
  // to equal the run_id (verified via the runs-API response -- HR's
  // `data.session_id` in the CloudEvents envelope is actually the run
  // id for this workflow shape). So when the per-node templated
  // webhook omits `run_id`, fall back to `call_id` instead of skipping
  // backfill entirely. `getRun` returns `null` on 404 so a genuinely
  // unrelated id doesn't throw; we still gate the outcome on whatever
  // data we do get back.
  const idForRunLookup = data.run_id ?? data.call_id
  const run = await getRun(idForRunLookup).catch((err) => {
    logger.warn({ run_id: data.run_id, call_id: data.call_id, err }, 'happyrobot getRun failed')
    return null
  })

  const merged = mergeRunIntoInput(data, run)
  const ready = isClassifyInputReady(merged)

  enrich({
    call_id: data.call_id,
    run_id: data.run_id,
    has_run_id: data.run_id !== undefined,
    carrier_mc: merged.carrier_mc,
    load_id: merged.load_id,
    call_status: data.status,
    transcript_length: merged.transcript.length,
    duration_seconds: merged.duration_seconds,
    hr_run_fetched: merged.hr_run_fetched,
    hr_classify_tag: merged.hr_classify_tag,
    transcript_source: merged.transcript_source,
    attempts_made: attemptsMade,
    max_attempts: maxAttempts,
    ready,
  })

  // Extraction race: HappyRobot's Extract node populates `carrier_mc` /
  // `load_id` on the `/v1/calls/:id` run view a beat after
  // `status_changed: completed` fires. Throwing here triggers BullMQ's
  // exponential backoff so we re-fetch the run on the next attempt.
  // On the final attempt we still persist a row so the dashboard
  // doesn't lose the call -- tagged with
  // `dropped_reason: 'extraction_timeout'` to distinguish it from a
  // genuine no-match drop.
  if (!ready && !isFinalAttempt) {
    enrich({
      skipped_write: true,
      skip_reason: 'extraction_not_ready',
      failure_stage: 'extraction_not_ready',
    })
    throw new Error(
      `HappyRobot extraction not ready for call ${data.call_id} (attempt ${attemptsMade + 1}/${maxAttempts}); will retry`,
    )
  }

  const negotiations = await convexService.negotiations.getByCallId(data.call_id)
  const finalNeg = negotiations.at(-1)
  const negotiatedRate = finalNeg?.accepted ? finalNeg.offered_rate : undefined
  const extractionFinalRate = numberFromExtraction(merged.extraction, 'final_rate')
  const final_rate = negotiatedRate ?? data.final_rate_from_extraction ?? extractionFinalRate

  // Post-merge authoritative validation:
  //   1. MC format (cheap, local) -- see validation.ts.
  //   2. Load existence in Convex (one indexed query).
  // These are what the user asked the webhook to enforce: no row
  // ever gets promoted to `booked` if either guard fails.
  const mc_valid = isValidMcFormat(merged.carrier_mc)
  const load_exists = await checkLoadExists(merged.load_id, { callId: data.call_id, enrich })

  const outcome = resolveOutcome({
    ready,
    isFinalAttempt,
    booking_decision: data.booking_decision,
    hr_classify_tag: merged.hr_classify_tag,
    status: data.status,
    transcript: merged.transcript,
    load_id: merged.load_id,
    carrier_mc: merged.carrier_mc,
  })

  // Authoritative booking gate: promote to `markBooked` only when
  // EVERY prerequisite is met. Missing load, malformed MC, or missing
  // final rate all drop back to the existing `createCallWithFallback`
  // path so we still capture the call without corrupting load-board
  // state. This is the "validate before booking" contract.
  const authoritative_book =
    outcome === 'booked' &&
    mc_valid &&
    load_exists &&
    merged.load_id !== undefined &&
    final_rate !== undefined

  enrich({
    mc_valid,
    load_exists,
    booking_decision: data.booking_decision,
    final_rate_from_extraction: data.final_rate_from_extraction,
    authoritative_book,
  })

  const writeResult = await writeClassifyResult({
    data,
    merged,
    outcome,
    final_rate,
    negotiations_count: negotiations.length,
    authoritative_book,
    load_exists,
    enrich,
  })

  callOutcomeCounter.add(1, { outcome })
  enrich({
    outcome,
    negotiation_rounds: negotiations.length,
    final_rate,
    load_status_updated: writeResult.load_status_updated,
    ...(writeResult.fellBack ? { failure_stage: 'convex_schema_drift' as const } : {}),
    ...(!ready && isFinalAttempt ? { dropped_reason: 'extraction_timeout' as const } : {}),
  })
}

export function createClassifyCallWorker(): Worker<ClassifyCallInput> {
  const worker = new Worker<ClassifyCallInput>(
    QUEUE_NAMES.classifyCall,
    async (job) => {
      const data = ClassifyCallInputSchema.parse(job.data)
      // BullMQ v5: `attemptsMade` counts prior failures (0 on the first
      // run, N-1 on the Nth). `opts.attempts` falls back to 1 for jobs
      // enqueued without a per-job override -- treat the very first run
      // as the only run in that degenerate case so we never loop.
      const maxAttempts = job.opts.attempts ?? 1

      await withWideEvent(
        'ClassifyCall',
        { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.classifyCall } },
        async (enrich) => {
          await runClassifyJob(data, { attemptsMade: job.attemptsMade, maxAttempts }, enrich)
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
