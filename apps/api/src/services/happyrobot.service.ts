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
      // `platform.happyrobot.ai/api/v1/*` 400s without this. Without
      // it the 400 response is indistinguishable from "run id not
      // found" (happyrobotFetch maps both to `null`) so the classify
      // worker silently loses the backfill every time. See
      // docs/happyrobot-setup.md §11.
      'x-organization-id': config.happyrobot.orgId,
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

/**
 * HR uses two name shapes across their APIs:
 *   - older flat fixtures: a single `name` field (e.g. `"Classify"`)
 *   - live `/api/v1/runs/:id` responses: split `integration_name` +
 *     `event_name` (e.g. `integration_name: "AI"`, `event_name:
 *     "Classify"`). We join them with a space so a single
 *     `includes('classif')` match works across both.
 *
 * `type` is also matched so synthetic events (`type: 'action'`,
 * `type: 'session'`) can still be located by the matchers that care
 * about type rather than name.
 */
function eventMatchText(ev: HappyRobotRunEvent): string {
  const obj = ev as Record<string, unknown>
  const integration = typeof obj.integration_name === 'string' ? obj.integration_name : ''
  const eventName = typeof obj.event_name === 'string' ? obj.event_name : ''
  const parts = [ev.name, integration, eventName, ev.type].filter((s): s is string => Boolean(s))
  return parts.join(' ')
}

function firstEventMatching(
  events: readonly HappyRobotRunEvent[],
  needles: readonly string[],
): HappyRobotRunEvent | undefined {
  for (const ev of events) {
    if (nameLooksLike(eventMatchText(ev), needles)) return ev
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

/**
 * HR's AI Classify / AI Extract events nest the actual LLM result
 * under `output.response` (with a sibling `output.input` / `output.prompt`
 * pair for debugging). `eventPayload` alone surfaces `response` as a
 * nested object, which top-level string lookups never see -- this
 * helper returns the `response` subtree so
 * `resolveRunClassification` / `resolveRunExtraction` can read the
 * real `classification` / `booking_decision` / `final_rate` fields.
 */
function aiNodeResponse(ev: HappyRobotRunEvent | undefined): Record<string, unknown> {
  const payload = eventPayload(ev)
  const response = payload.response
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return response as Record<string, unknown>
  }
  return {}
}

/**
 * HR's variable resolver fires AI nodes the moment their template
 * inputs would otherwise block -- so when an AI node is wired
 * downstream of the Voice Agent but HR hasn't yet resolved
 * `@transcript`, it runs the LLM against the literal string
 * `"@transcript"`. The LLM dutifully returns "Not interested" /
 * `booking_decision: "no"` with reasoning like "no transcript
 * provided". Trusting that output over the real call transcript
 * keyword scan is strictly worse than ignoring it.
 *
 * Two overlapping signals, in priority order:
 *
 *   1. Timestamp heuristic (most reliable). If the session event has
 *      a `timestamp` + `duration`, compute its expected end time. Any
 *      AI event whose timestamp is earlier than the session end
 *      clearly ran against stale / empty variable state -- a
 *      correctly-wired Classify / Extract can only fire AFTER the
 *      voice session completes.
 *   2. `output.input` is an unresolved HR variable reference
 *      (`@transcript`, `@duration`, or `@foo @bar` concatenations).
 *      Only the Classify node exposes this field today; Extract's
 *      unresolved templates live inside `output.prompt` and aren't
 *      inspected -- the timestamp check catches those.
 *
 * Either signal is sufficient. A missing timestamp / missing `input`
 * field is treated as non-stale so older fixtures keep passing.
 */
function timestampSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms / 1000 : undefined
}

function sessionEndSeconds(session: HappyRobotRunEvent | undefined): number | undefined {
  if (!session) return undefined
  const start = timestampSeconds(session.timestamp)
  const raw = (session as Record<string, unknown>).duration
  const duration = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
  if (start === undefined || duration === undefined) return undefined
  return start + duration
}

function isAiNodeStale(
  ev: HappyRobotRunEvent | undefined,
  session: HappyRobotRunEvent | undefined,
): boolean {
  if (!ev) return false

  const sessionEnd = sessionEndSeconds(session)
  const eventTs = timestampSeconds(ev.timestamp)
  if (sessionEnd !== undefined && eventTs !== undefined && eventTs < sessionEnd) {
    // AI node fired BEFORE the voice session completed -- its inputs
    // were unresolved regardless of what the output now says. 1s
    // slop accounts for HR's own clock skew between workers.
    return eventTs < sessionEnd - 1
  }

  const payload = eventPayload(ev)
  const input = payload.input
  if (typeof input !== 'string') return false
  const trimmed = input.trim()
  if (trimmed.length === 0) return true
  return /^(@[A-Za-z_][\w.]*\s*)+$/.test(trimmed)
}

/**
 * Pull the session event (`type: 'session'`) out of the events array.
 * HR wraps the voice call into a single session-typed event whose
 * `messages` field is the authoritative transcript and whose
 * `duration` is the actual call length. Only the last session is
 * returned; pre-transfer / retry sessions in the same run are
 * ignored because they don't represent the final call state.
 */
function lastSessionEvent(events: readonly HappyRobotRunEvent[]): HappyRobotRunEvent | undefined {
  let result: HappyRobotRunEvent | undefined
  for (const ev of events) {
    if (ev.type === 'session') result = ev
  }
  return result
}

/**
 * Convert HR session `messages` (chat-completion shape with
 * `role: 'user' | 'assistant' | 'tool' | 'event'` and `content`) into
 * our canonical `{role, text}` turns. Drops `event` / `tool` entries
 * and HR's "Thoughts" stage directions so the synthesized transcript
 * is only the carrier / agent utterances the keyword scan should see.
 */
function speakersFromSessionMessages(
  session: HappyRobotRunEvent | undefined,
): SpeakerTurn[] | undefined {
  if (!session) return undefined
  const messages = (session as Record<string, unknown>).messages
  if (!Array.isArray(messages) || messages.length === 0) return undefined
  const turns: SpeakerTurn[] = []
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    const role = typeof m.role === 'string' ? m.role : undefined
    const content = m.content ?? m.text ?? m.message
    if (role === 'event' || role === 'tool' || !role) continue
    if (typeof content !== 'string' || content.trim().length === 0) continue
    // HR's voice agent injects `<Thoughts>...</Thoughts>` stage
    // directions into the user channel when the caller is silent.
    // They'd dominate the keyword scan otherwise.
    if (content.trim().startsWith('<Thoughts>')) continue
    turns.push({ role, text: content })
  }
  return turns.length > 0 ? turns : undefined
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
  extractResponse: Record<string, unknown>,
  extractPayload: Record<string, unknown>,
  output: Record<string, unknown>,
  extractStale: boolean,
): Record<string, unknown> {
  if (parsed.extraction) return parsed.extraction
  if (parsed.extracted_data) return parsed.extracted_data
  // HR's actual run shape: the extracted fields live under the Extract
  // event's `output.response`. The prior fallback returned the whole
  // event payload (including `prompt`, `input`, `_llm_usage`), which
  // polluted `stringFromExtraction('reference_number')` with undefined
  // lookups instead of the real values.
  if (!extractStale && Object.keys(extractResponse).length > 0) return extractResponse
  // `extractStale === true` means the Extract node fired against an
  // unresolved `@transcript` and returned garbage ("no" / "" for
  // everything). Returning `{}` here lets the webhook-level
  // `booking_decision` / `final_rate_from_extraction` override it if
  // HR later ships those directly on the templated body.
  if (extractStale) return {}
  if (Object.keys(extractPayload).length > 0) return extractPayload
  if (Object.keys(output).length > 0) return output
  return {}
}

function resolveRunClassification(
  parsed: HappyRobotRunResponse,
  classifyResponse: Record<string, unknown>,
  classifyPayload: Record<string, unknown>,
  output: Record<string, unknown>,
  classifyStale: boolean,
): { tag: string | undefined } | undefined {
  // When the Classify node ran against an unresolved template input
  // (see `isAiNodeStale`), its "Not interested" verdict is LLM
  // hallucination from an empty prompt, not a real classification.
  // Treating the tag as absent lets the worker's keyword scan run
  // against the authoritative session transcript instead.
  if (classifyStale) return undefined
  const topTag = parsed.classification?.tag
  const responseTag = stringFromObj(classifyResponse, 'classification', 'tag')
  const eventTag = stringFromObj(classifyPayload, 'tag', 'classification', 'classification_tag')
  const outputTag = stringFromObj(output, 'classification_tag', 'classify_tag')
  const tag = topTag ?? responseTag ?? eventTag ?? outputTag
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
 * classify and sentiment workers need. Handles four overlapping
 * inputs so we never have to branch on "which HR endpoint fed us this":
 *   1. Flat top-level fields (`transcript`, `extraction`, `classification`)
 *      -- used by unit-test fixtures and older HR payloads.
 *   2. Per-node `events` entries, matched by node name (`Classify`,
 *      `Extract`, `Voice Agent`). The Classify / Extract nodes' actual
 *      LLM output lives under `output.response`, not top-level on the
 *      event payload.
 *   3. The session event's `messages` array -- authoritative transcript
 *      source when HR doesn't surface a flat `transcript` field. This
 *      is the only path that works on the current `gggfox` workflow.
 *   4. Aggregate `output` / `outputs` maps with the final session state.
 *
 * Staleness: AI Classify / AI Extract events that ran before HR
 * resolved their `@transcript` input are detected via
 * `isAiNodeStale` and their outputs suppressed -- keeping a stale
 * "Not interested" tag from poisoning the outcome resolver.
 *
 * Pure -- no network, no I/O.
 */
export function normalizeRun(parsed: HappyRobotRunResponse): HappyRobotCallRun {
  const events = parsed.events ?? []
  const classifyEvent = firstEventMatching(events, ['classif'])
  const extractEvent = firstEventMatching(events, ['extract'])
  const voiceEvent = firstEventMatching(events, ['voice agent', 'voice'])
  const sessionEvent = lastSessionEvent(events)

  const classifyPayload = eventPayload(classifyEvent)
  const extractPayload = eventPayload(extractEvent)
  const voicePayload = eventPayload(voiceEvent)
  const classifyResponse = aiNodeResponse(classifyEvent)
  const extractResponse = aiNodeResponse(extractEvent)

  const classifyStale = isAiNodeStale(classifyEvent, sessionEvent)
  const extractStale = isAiNodeStale(extractEvent, sessionEvent)

  const output = parsed.output ?? parsed.outputs ?? {}

  const extraction = resolveRunExtraction(
    parsed,
    extractResponse,
    extractPayload,
    output,
    extractStale,
  )
  const classification = resolveRunClassification(
    parsed,
    classifyResponse,
    classifyPayload,
    output,
    classifyStale,
  )

  const speakers =
    extractSpeakersFromPayload(parsed as Record<string, unknown>) ??
    extractSpeakersFromPayload(voicePayload) ??
    speakersFromSessionMessages(sessionEvent)

  const transcript = resolveRunTranscript(parsed, extraction, voicePayload, output, speakers)

  const duration_seconds =
    parsed.duration_seconds ??
    numberFromObj(voicePayload, 'duration_seconds') ??
    (sessionEvent ? numberFromObj(sessionEvent as Record<string, unknown>, 'duration') : undefined)

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
