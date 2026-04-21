import { OFFER_ACCEPT_MARGIN_PERCENT } from '@carrier-sales/shared'
import { convexService } from './convex.service.js'

/**
 * Shared booking contract used by both the `book_load` HTTP tool route
 * (explicit caller-initiated booking via the HappyRobot workflow) and
 * the classify-call worker (post-webhook auto-booking when signals
 * indicate the carrier agreed). Centralizing the logic keeps the
 * guards identical across both paths -- without this, the worker's
 * authoritative-book path was missing the `agreed_rate` bounds check
 * the HTTP route enforces, so a hallucinated extraction rate could
 * silently flip a load at a junk number.
 *
 * The service is the single place that writes `calls.markBooked` +
 * `loads.updateStatus('booked')`. Callers that need different error
 * semantics (HTTP status codes vs queue enrichment fields) inspect
 * the structured result shape instead of catching exceptions.
 */

export type BookAttemptInput = {
  call_id: string
  load_id: string
  carrier_mc: string
  agreed_rate: number
  started_at?: string
  ended_at?: string
}

export type BookAttemptFailure =
  | { booked: false; reason: 'load_not_found' }
  | {
      booked: false
      reason: 'load_not_bookable'
      load_status: string
      loadboard_rate: number
    }
  | {
      booked: false
      reason: 'rate_out_of_bounds'
      loadboard_rate: number
      min_acceptable_rate: number
    }
  | { booked: false; reason: 'already_booked'; loadboard_rate: number }

export type BookAttemptSuccess = {
  booked: true
  final_rate: number
  loadboard_rate: number
  discount_percent: number
  load_status_updated: boolean
}

export type BookAttemptResult = BookAttemptSuccess | BookAttemptFailure

/**
 * The subset of the Convex `loads` row that `evaluateBookability`
 * reads. Kept narrow so unit tests don't have to construct every
 * field, and so a new optional column on the table can't accidentally
 * widen the guard's contract.
 */
export interface BookabilityLoadView {
  status: string
  loadboard_rate: number
}

export type BookabilityEvaluation =
  | { ok: true; loadboard_rate: number; min_acceptable_rate: number }
  | {
      ok: false
      reason: 'already_booked' | 'load_not_bookable' | 'rate_out_of_bounds'
      loadboard_rate: number
      load_status?: string
      min_acceptable_rate?: number
    }

/**
 * Pure guard logic for whether a load can be booked at a given rate.
 * Split out of `attemptBookLoad` so the `[loadboard_rate * (1 -
 * OFFER_ACCEPT_MARGIN_PERCENT%), loadboard_rate]` bound and the
 * bookable-state set (`available` / `in_negotiation`) are unit-testable
 * without stubbing Convex. Pure -- no network, no time, no mutations.
 *
 * Order matters:
 *   1. `already_booked` short-circuits first so idempotent callers can
 *      treat this as success (a prior mutation already flipped the row).
 *   2. `load_not_bookable` covers `expired` / `cancelled` / any future
 *      status added to Convex -- the default-to-reject posture prevents
 *      a new status from silently becoming bookable.
 *   3. Rate bounds last so we only report a rate error for loads that
 *      could otherwise be booked.
 */
export function evaluateBookability(
  load: BookabilityLoadView,
  agreed_rate: number,
): BookabilityEvaluation {
  if (load.status === 'booked') {
    return { ok: false, reason: 'already_booked', loadboard_rate: load.loadboard_rate }
  }
  if (load.status !== 'available' && load.status !== 'in_negotiation') {
    return {
      ok: false,
      reason: 'load_not_bookable',
      loadboard_rate: load.loadboard_rate,
      load_status: load.status,
    }
  }
  const min_acceptable_rate = load.loadboard_rate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100)
  if (agreed_rate < min_acceptable_rate || agreed_rate > load.loadboard_rate) {
    return {
      ok: false,
      reason: 'rate_out_of_bounds',
      loadboard_rate: load.loadboard_rate,
      min_acceptable_rate,
    }
  }
  return { ok: true, loadboard_rate: load.loadboard_rate, min_acceptable_rate }
}

/**
 * Attempt to book a load at `agreed_rate` on behalf of the carrier.
 *
 * Order of guards (fail fast):
 *   1. Load exists in Convex -- `load_not_found`.
 *   2. `evaluateBookability` applies the state + rate-bounds guards.
 *
 * Success path writes `calls.markBooked` (authoritative call-row
 * booking mutation) first, then `loads.updateStatus('booked')`. The
 * order matters: the call row is the source of truth for billing and
 * metrics, so a failure between the two mutations leaves the booking
 * recorded even if the load-board status update is delayed. The
 * load-status failure is surfaced via `load_status_updated: false`
 * rather than thrown so the caller can decide whether to alert.
 */
export async function attemptBookLoad(input: BookAttemptInput): Promise<BookAttemptResult> {
  const load = await convexService.loads.getByLoadId(input.load_id)
  if (!load) {
    return { booked: false, reason: 'load_not_found' }
  }

  const evaluation = evaluateBookability(load, input.agreed_rate)
  if (!evaluation.ok) {
    if (evaluation.reason === 'already_booked') {
      return {
        booked: false,
        reason: 'already_booked',
        loadboard_rate: evaluation.loadboard_rate,
      }
    }
    if (evaluation.reason === 'load_not_bookable') {
      return {
        booked: false,
        reason: 'load_not_bookable',
        load_status: evaluation.load_status ?? load.status,
        loadboard_rate: evaluation.loadboard_rate,
      }
    }
    return {
      booked: false,
      reason: 'rate_out_of_bounds',
      loadboard_rate: evaluation.loadboard_rate,
      // `min_acceptable_rate` is always set on `rate_out_of_bounds`
      // by the evaluator; fall back to a recomputed value for the
      // typechecker rather than a non-null assertion.
      min_acceptable_rate:
        evaluation.min_acceptable_rate ??
        evaluation.loadboard_rate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100),
    }
  }

  const now = new Date().toISOString()
  await convexService.calls.markBooked({
    call_id: input.call_id,
    load_id: input.load_id,
    carrier_mc: input.carrier_mc,
    final_rate: input.agreed_rate,
    started_at: input.started_at ?? now,
    ended_at: input.ended_at ?? now,
  })

  let load_status_updated = false
  try {
    await convexService.loads.updateStatus(input.load_id, 'booked')
    load_status_updated = true
  } catch {
    // `markBooked` succeeded; the call row is the source of truth for
    // metrics and the dashboard's Call History view. The load-board
    // will look stale until a retry picks it up, but we don't re-throw
    // because that would mask the successful call-row write and the
    // caller's retry logic would then double-book.
  }

  return {
    booked: true,
    final_rate: input.agreed_rate,
    loadboard_rate: evaluation.loadboard_rate,
    discount_percent:
      ((evaluation.loadboard_rate - input.agreed_rate) / evaluation.loadboard_rate) * 100,
    load_status_updated,
  }
}
