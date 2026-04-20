/**
 * Pure normalization of HappyRobot's workflow-completed webhook body.
 *
 * HappyRobot posts a CloudEvents 1.0 envelope (`session.status_changed`)
 * whose real payload lives under `data`:
 *
 *   { specversion, id, source, type, time, datacontenttype,
 *     data: { run_id, session_id, status: { previous, current,
 *       updated_at }, org, use_case, ... } }
 *
 * The UI has no event-type selector and no custom-body option, so the
 * envelope shape is fixed and the `data` object does NOT carry the
 * transcript, tool variables, or extraction. Correlation back to the
 * tool calls hitting `/api/v1/offers` flows through `data.session_id`
 * -- the `negotiate_offer` tool templates `call_id: @session_id`.
 *
 * We still honor the older flat shape (`raw.call_id`, `raw.transcript`,
 * `raw.speakers`, ...) as a compatibility path in tests and in case a
 * future HR workflow is wired with an explicit body template.
 */

export interface SpeakerTurn {
  role: string
  text: string
}

export interface UnwrappedCallEvent {
  /**
   * The payload the rest of the normalizer should read. `raw.data`
   * when a CloudEvents envelope is detected, otherwise `raw` itself.
   */
  inner: Record<string, unknown>
  /** `true` when `raw.specversion` + object `raw.data` were present. */
  is_cloud_event: boolean
  /** `raw.type` -- e.g. `"session.status_changed"`. */
  cloudevent_type: string | undefined
  /** `raw.time` if present -- the envelope emission time. */
  event_time: string | undefined
  /** `data.status.current` -- e.g. `"completed"`, `"in-progress"`. */
  status_current: string | undefined
  /** `data.status.previous`. */
  status_previous: string | undefined
  /** `data.status.updated_at`. */
  status_updated_at: string | undefined
  /** `data.session_id` -- correlation key with `/api/v1/offers`. */
  session_id: string | undefined
  /** `data.run_id`. */
  run_id: string | undefined
}

/**
 * HappyRobot session lifecycle statuses from their public docs. Only
 * the terminal ones should advance pipeline state -- `queued` and
 * `in-progress` fire a webhook per transition but do not represent a
 * finished call.
 */
const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'canceled',
  'missed',
  'voicemail',
  'busy',
])

/**
 * `true` when `status_current` should advance downstream workers.
 * Non-terminal statuses (`queued`, `in-progress`) are acked but skipped.
 * For payloads without any status field (older flat shape) we return
 * `true` so we never regress that path.
 */
export function isTerminalStatus(status_current: string | undefined): boolean {
  if (status_current === undefined) return true
  return TERMINAL_STATUSES.has(status_current)
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined
  return v as Record<string, unknown>
}

/**
 * Detect a CloudEvents 1.0 envelope and return the `data` payload
 * alongside extracted envelope/status metadata. For non-CloudEvents
 * bodies `inner` is the caller's `raw` and `is_cloud_event` is `false`.
 */
export function unwrapCloudEventPayload(raw: Record<string, unknown>): UnwrappedCallEvent {
  const specversion = pickString(raw, 'specversion')
  const data = asObject(raw.data)
  const is_cloud_event = specversion !== undefined && data !== undefined

  const inner = is_cloud_event && data ? data : raw

  const statusField = asObject(inner.status)
  const status_current = statusField
    ? pickString(statusField, 'current')
    : pickString(inner, 'status')
  const status_previous = statusField ? pickString(statusField, 'previous') : undefined
  const status_updated_at = statusField ? pickString(statusField, 'updated_at') : undefined

  return {
    inner,
    is_cloud_event,
    cloudevent_type: pickString(raw, 'type'),
    event_time: pickString(raw, 'time'),
    status_current,
    status_previous,
    status_updated_at,
    session_id: pickString(inner, 'session_id'),
    run_id: pickString(inner, 'run_id'),
  }
}

function firstNonEmptyString(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

const ROLE_KEYS = ['role', 'speaker'] as const
const TEXT_KEYS = ['text', 'content', 'message'] as const

function coerceTurn(item: unknown): SpeakerTurn | undefined {
  if (!item || typeof item !== 'object') return undefined
  const obj = item as Record<string, unknown>
  const role = firstNonEmptyString(obj, ROLE_KEYS)
  const text = firstNonEmptyString(obj, TEXT_KEYS)
  if (!role || !text) return undefined
  return { role, text }
}

/**
 * Return the first non-empty speaker array we can find among `values`,
 * coerced into canonical `{role, text}` turns. Mapping:
 *   - `role` falls back to `speaker`
 *   - `text` falls back to `content` / `message`
 * Entries missing either side are dropped, not defaulted.
 */
export function pickSpeakers(...values: unknown[]): SpeakerTurn[] | undefined {
  for (const value of values) {
    if (!Array.isArray(value) || value.length === 0) continue
    const turns: SpeakerTurn[] = []
    for (const item of value) {
      const turn = coerceTurn(item)
      if (turn) turns.push(turn)
    }
    if (turns.length > 0) return turns
  }
  return undefined
}

/**
 * Pull speakers out of a raw HappyRobot payload, checking every
 * documented location in priority order. Nested `transcript.speakers`
 * is checked only when `transcript` is an object (HappyRobot sends a
 * plain string in some templates, an object-with-speakers in others).
 */
export function extractSpeakersFromPayload(
  raw: Record<string, unknown>,
): SpeakerTurn[] | undefined {
  const extraction = (raw.extraction ?? {}) as Record<string, unknown>
  const rawTranscript = raw.transcript
  const nestedTranscriptSpeakers =
    rawTranscript && typeof rawTranscript === 'object' && !Array.isArray(rawTranscript)
      ? (rawTranscript as Record<string, unknown>).speakers
      : undefined

  return pickSpeakers(
    raw.speakers,
    nestedTranscriptSpeakers,
    extraction.speakers,
    raw.messages,
    extraction.messages,
  )
}

/**
 * Build a flat transcript string for downstream workers (the sentiment
 * worker scans a flat string of signal words). Prefer the caller's own
 * string; synthesize from speaker turns only when absent.
 */
export function resolveTranscript(
  raw: Record<string, unknown>,
  speakers: readonly SpeakerTurn[] | undefined,
): string {
  const extraction = (raw.extraction ?? {}) as Record<string, unknown>
  const rawTranscript = raw.transcript
  const direct =
    typeof rawTranscript === 'string' && rawTranscript.length > 0 ? rawTranscript : undefined
  const fromExtraction =
    typeof extraction.transcript === 'string' && extraction.transcript.length > 0
      ? (extraction.transcript as string)
      : undefined
  if (direct) return direct
  if (fromExtraction) return fromExtraction
  if (speakers && speakers.length > 0) {
    return speakers.map((s) => `${s.role}: ${s.text}`).join('\n')
  }
  return ''
}
