/**
 * Pure payload validators shared by the call-completed webhook route and
 * the classify-call worker. Pure -- no network, no Convex, no logger.
 *
 * These guards exist because HappyRobot's `session.status_changed` envelope
 * carries only `session_id`/`run_id`, while the additional per-node Webhook
 * node HR fires after `AI Extract` ships the full templated body (see
 * `docs/happyrobot-setup.md` §9.1). Either source can put malformed values
 * on the wire (`carrier_mc: "264184"` is fine; `carrier_mc: "my number is
 * 264184"` from an LLM hallucination is not), so every mutation downstream
 * is gated on the predicates below.
 */
export const MC_NUMBER_PATTERN = /^\d{1,8}$/

/**
 * True when `mc` looks like an FMCSA Motor Carrier number -- digits only,
 * 1-8 characters. Real MCs top out around 7 digits today; the generous
 * upper bound protects against a future expansion without a redeploy.
 *
 * `undefined` / empty / the sentinel `"unknown"` -> false. The sentinel is
 * intentionally excluded so code that checks `mc_valid` before calling
 * `markBooked` can never write a `booked` row against `carrier_mc:
 * "unknown"` -- exactly the data-loss mode we hit in prod.
 */
export function isValidMcFormat(mc: string | undefined | null): boolean {
  if (typeof mc !== 'string') return false
  if (mc.length === 0) return false
  if (mc === 'unknown') return false
  return MC_NUMBER_PATTERN.test(mc)
}

/**
 * True when `load_id` is a non-empty, non-template string. DB existence
 * is checked separately via `lookupLoad` in the classify worker; this is
 * the cheap first-pass guard used on the hot path so the webhook route
 * can decide whether to short-circuit before enqueueing.
 */
export function isPlausibleLoadId(load_id: string | undefined | null): boolean {
  if (typeof load_id !== 'string') return false
  if (load_id.length === 0) return false
  // Same template-string guard as `_call-id.ts` (e.g. `@reference_number`).
  if (/^[@{:]/.test(load_id)) return false
  if (/[@{}]/.test(load_id)) return false
  return true
}

/**
 * HappyRobot's AI Extract node returns every field as a string (including
 * numeric-looking ones and the booking decision). It coerces absent values
 * to `""` instead of omitting the key, so a strict `"yes" | "no"` check
 * must tolerate both casings, whitespace, and the empty-string default.
 */
export function extractBookingDecision(extracted: unknown): 'yes' | 'no' | undefined {
  if (!extracted || typeof extracted !== 'object') return undefined
  const raw = (extracted as Record<string, unknown>).booking_decision
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'true') return 'yes'
  if (normalized === 'no' || normalized === 'false') return 'no'
  return undefined
}

/**
 * Pull the final rate from `extracted_data`, tolerating both the number
 * shape our own tests emit and HR's Extract-node string coercion.
 * Returns `undefined` for `""`, non-numeric strings, and non-positive
 * values so downstream code can `?? existing_rate` safely.
 */
export function extractFinalRate(extracted: unknown): number | undefined {
  if (!extracted || typeof extracted !== 'object') return undefined
  const raw = (extracted as Record<string, unknown>).final_rate
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.length > 0) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

/**
 * HR's Extract node also stringifies `reference_number` -- the canonical
 * load id source when the workflow's webhook body templates the
 * extraction. Falls back to `undefined` on empty-string so the classify
 * worker can keep using the webhook-top-level `load_id` path.
 */
export function extractReferenceNumber(extracted: unknown): string | undefined {
  if (!extracted || typeof extracted !== 'object') return undefined
  const raw = (extracted as Record<string, unknown>).reference_number
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
