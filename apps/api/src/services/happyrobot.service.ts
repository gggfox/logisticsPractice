import { z } from 'zod'
import { config } from '../config.js'
import {
  type SpeakerTurn,
  extractSpeakersFromPayload,
} from '../routes/webhooks/normalize-call-payload.js'

async function happyrobotFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${config.happyrobot.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.happyrobot.apiKey}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })

  // Not-found signals: 400 (bad id), 404 (missing), 422 (unprocessable id).
  // 401/403/429/5xx stay as throws -- those are our problems, not "call not found".
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return null
  }

  if (!response.ok) {
    // Capture a bounded body snippet for diagnostics so the next failure
    // surfaces the actual upstream shape. Path has no secrets in it; the
    // Authorization header is only on the request, never the response.
    let snippet = ''
    try {
      snippet = (await response.text()).slice(0, 200)
    } catch {
      // body already consumed or unreadable; keep snippet empty
    }
    const suffix = snippet ? ` -- ${snippet}` : ''
    throw new Error(`HappyRobot API error ${response.status}: ${response.statusText}${suffix}`)
  }

  return response.json()
}

/**
 * DEPRECATED. Proxies to `app.happyrobot.ai/api/v1/calls/:id/transcript`,
 * which is NOT reachable from the `platform.happyrobot.ai` base URL this
 * service is configured for. Kept only so the legacy internal route in
 * `routes/internal/get-transcript.ts` still builds until it is replaced
 * with a Convex read. See `getRun` below for the endpoint that actually
 * works on our current base URL.
 */
export async function getCallTranscript(
  callId: string,
): Promise<{ transcript: string; speakers: Array<{ role: string; text: string }> } | null> {
  const data = (await happyrobotFetch(`/api/v1/calls/${callId}/transcript`)) as {
    transcript?: string
    speakers?: Array<{ role: string; text: string }>
  } | null

  if (data === null) {
    return null
  }

  return {
    transcript: data.transcript ?? '',
    speakers: data.speakers ?? [],
  }
}

/**
 * Permissive schema for `GET /api/v1/runs/:run_id` on
 * `platform.happyrobot.ai`. HappyRobot's response is a superset of a few
 * shapes we care about:
 *   - top-level fields like `transcript` / `extraction` / `classification`
 *     that older / flat payloads still carry (and that our unit tests
 *     pin);
 *   - an `events` array where each entry is a workflow-node firing
 *     (`name` is the node label, `data` is that node's output);
 *   - an `output` / `outputs` map with aggregate session outputs.
 *
 * `.passthrough()` preserves unknown keys so `normalizeRun` can mine
 * them if HR adds something useful later, and keeps the schema robust
 * against HR tweaking field names.
 */
export const HappyRobotRunEventSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    data: z.record(z.unknown()).optional(),
    output: z.record(z.unknown()).optional(),
    timestamp: z.string().optional(),
  })
  .passthrough()

export const HappyRobotRunResponseSchema = z
  .object({
    id: z.string().optional(),
    session_id: z.string().optional(),
    org_id: z.string().optional(),
    use_case_id: z.string().optional(),
    transcript: z.string().optional(),
    speakers: z.array(z.object({ role: z.string(), text: z.string() }).passthrough()).optional(),
    messages: z.array(z.record(z.unknown())).optional(),
    extraction: z.record(z.unknown()).optional(),
    extracted_data: z.record(z.unknown()).optional(),
    classification: z
      .object({
        tag: z.string().optional(),
      })
      .passthrough()
      .optional(),
    duration_seconds: z.number().optional(),
    started_at: z.string().optional(),
    ended_at: z.string().optional(),
    events: z.array(HappyRobotRunEventSchema).optional(),
    output: z.record(z.unknown()).optional(),
    outputs: z.record(z.unknown()).optional(),
  })
  .passthrough()

export type HappyRobotRunResponse = z.infer<typeof HappyRobotRunResponseSchema>
export type HappyRobotRunEvent = z.infer<typeof HappyRobotRunEventSchema>

/**
 * Back-compat alias. Existing unit tests import
 * `HappyRobotCallRunSchema` and feed it the old flat shape; the runs
 * schema is a strict superset so those tests keep passing.
 */
export const HappyRobotCallRunSchema = HappyRobotRunResponseSchema

export interface HappyRobotCallRun {
  transcript: string
  speakers: SpeakerTurn[] | undefined
  extraction: Record<string, unknown>
  classification: { tag: string | undefined } | undefined
  duration_seconds: number | undefined
  started_at: string | undefined
  ended_at: string | undefined
}

function nameLooksLike(name: string | undefined, needles: readonly string[]): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  return needles.some((n) => lower.includes(n))
}

function firstEventMatching(
  events: readonly HappyRobotRunEvent[],
  needles: readonly string[],
): HappyRobotRunEvent | undefined {
  for (const ev of events) {
    if (nameLooksLike(ev.name, needles) || nameLooksLike(ev.type, needles)) return ev
  }
  return undefined
}

function eventPayload(ev: HappyRobotRunEvent | undefined): Record<string, unknown> {
  if (!ev) return {}
  // HR has used both `data` and `output` for node payloads in different
  // event shapes; merge with `data` winning so the more specific field
  // takes precedence when both are present. Spreading `undefined` is a
  // no-op in JS so we don't need an `?? {}` guard.
  return { ...ev.output, ...ev.data }
}

function stringFromObj(
  obj: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

function numberFromObj(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function resolveRunExtraction(
  parsed: HappyRobotRunResponse,
  extractPayload: Record<string, unknown>,
  output: Record<string, unknown>,
): Record<string, unknown> {
  if (parsed.extraction) return parsed.extraction
  if (parsed.extracted_data) return parsed.extracted_data
  if (Object.keys(extractPayload).length > 0) return extractPayload
  if (Object.keys(output).length > 0) return output
  return {}
}

function resolveRunClassification(
  parsed: HappyRobotRunResponse,
  classifyPayload: Record<string, unknown>,
  output: Record<string, unknown>,
): { tag: string | undefined } | undefined {
  const topTag = parsed.classification?.tag
  const eventTag = stringFromObj(classifyPayload, 'tag', 'classification', 'classification_tag')
  const outputTag = stringFromObj(output, 'classification_tag', 'classify_tag')
  const tag = topTag ?? eventTag ?? outputTag
  if (parsed.classification === undefined && tag === undefined) return undefined
  return { tag }
}

function resolveRunTranscript(
  parsed: HappyRobotRunResponse,
  extraction: Record<string, unknown>,
  voicePayload: Record<string, unknown>,
  output: Record<string, unknown>,
  speakers: SpeakerTurn[] | undefined,
): string {
  const synthesized =
    speakers && speakers.length > 0 ? speakers.map((s) => `${s.role}: ${s.text}`).join('\n') : ''
  return (
    stringFromObj(parsed as Record<string, unknown>, 'transcript') ??
    stringFromObj(extraction, 'transcript') ??
    stringFromObj(voicePayload, 'transcript') ??
    stringFromObj(output, 'transcript') ??
    synthesized
  )
}

/**
 * Normalize a HappyRobot runs-API response into the narrow shape the
 * classify and sentiment workers need. Handles three overlapping
 * inputs so we never have to branch on "which HR endpoint fed us this":
 *   1. Flat top-level fields (`transcript`, `extraction`, `classification`)
 *      -- used by unit-test fixtures and older HR payloads.
 *   2. Per-node `events` entries, matched by node name (`Classify`,
 *      `Extract`, `Voice Agent`).
 *   3. Aggregate `output` / `outputs` maps with the final session state.
 * Pure -- no network, no I/O.
 */
export function normalizeRun(parsed: HappyRobotRunResponse): HappyRobotCallRun {
  const events = parsed.events ?? []
  const classifyPayload = eventPayload(firstEventMatching(events, ['classif']))
  const extractPayload = eventPayload(firstEventMatching(events, ['extract']))
  // 'voice' only -- don't match bare 'agent', that would pick up
  // "Reasoning Agent" / other non-voice nodes in workflows that use them.
  const voicePayload = eventPayload(firstEventMatching(events, ['voice agent', 'voice']))

  const output = parsed.output ?? parsed.outputs ?? {}

  const extraction = resolveRunExtraction(parsed, extractPayload, output)
  const classification = resolveRunClassification(parsed, classifyPayload, output)

  const speakers =
    extractSpeakersFromPayload(parsed as Record<string, unknown>) ??
    extractSpeakersFromPayload(voicePayload)

  const transcript = resolveRunTranscript(parsed, extraction, voicePayload, output, speakers)

  const duration_seconds =
    parsed.duration_seconds ?? numberFromObj(voicePayload, 'duration_seconds')

  return {
    transcript,
    speakers,
    extraction,
    classification,
    duration_seconds,
    started_at: parsed.started_at,
    ended_at: parsed.ended_at,
  }
}

/**
 * Back-compat alias. The old `normalizeCallRun` name is still imported
 * by existing unit tests -- it has always been fed the flat shape that
 * the runs schema now accepts as a subset.
 */
export const normalizeCallRun = normalizeRun

/**
 * Fetch a workflow run from `GET /api/v1/runs/:run_id` on
 * `platform.happyrobot.ai` and normalize it for the classify and
 * sentiment workers. Returns `null` on 404 / bad id. No retries:
 * BullMQ already retries the worker on transient failure.
 *
 * NOTE: this replaces the old `getCallRun(callId)` which hit the
 * nonexistent `/api/v1/calls/:id` on the platform host (that endpoint
 * lives on `app.happyrobot.ai`, not `platform.happyrobot.ai`, so every
 * call quietly 404'd and returned `null`, keeping the classify worker
 * stuck on `extraction_not_ready`).
 */
export async function getRun(runId: string): Promise<HappyRobotCallRun | null> {
  const raw = await happyrobotFetch(`/api/v1/runs/${runId}`)
  if (raw === null) return null
  const parsed = HappyRobotRunResponseSchema.parse(raw)
  return normalizeRun(parsed)
}
