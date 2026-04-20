/**
 * Pure normalization of HappyRobot's workflow-completed webhook body.
 *
 * HappyRobot exposes call data through a mix of our documented fields
 * (when the user wires them into the workflow UI) and their native
 * envelope (`run_id`, `session_id`, `variables`, `extraction`, ...).
 * Speaker turns in particular show up under several keys depending on
 * the workflow template -- `raw.speakers`, `raw.messages`,
 * `raw.transcript.speakers`, `extraction.speakers`, etc. -- and
 * individual turns use either `{role, text}` or `{speaker, content}`.
 *
 * Consolidating into a single canonical shape here lets the route stay
 * flat and the unit tests stay honest.
 */

export interface SpeakerTurn {
  role: string
  text: string
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
