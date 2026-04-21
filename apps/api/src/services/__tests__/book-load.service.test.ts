import { OFFER_ACCEPT_MARGIN_PERCENT } from '@carrier-sales/shared'
import { describe, expect, it } from 'vitest'
import { type BookabilityLoadView, evaluateBookability } from '../book-load.service.js'

const load = (overrides: Partial<BookabilityLoadView> = {}): BookabilityLoadView => ({
  status: 'available',
  loadboard_rate: 2000,
  ...overrides,
})

describe('evaluateBookability', () => {
  it('accepts a rate equal to the posted loadboard rate', () => {
    const result = evaluateBookability(load(), 2000)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.loadboard_rate).toBe(2000)
      expect(result.min_acceptable_rate).toBe(2000 * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100))
    }
  })

  it('accepts a rate exactly on the 95% minimum', () => {
    // 2000 * 0.95 = 1900. Boundary case -- carriers asking for the
    // exact floor should book, not get rate_out_of_bounds.
    const result = evaluateBookability(load(), 1900)
    expect(result.ok).toBe(true)
  })

  it('rejects a rate one dollar below the 95% minimum as rate_out_of_bounds', () => {
    const result = evaluateBookability(load(), 1899)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('rate_out_of_bounds')
      expect(result.loadboard_rate).toBe(2000)
      expect(result.min_acceptable_rate).toBe(1900)
    }
  })

  it('rejects a rate above the posted loadboard rate as rate_out_of_bounds', () => {
    // Above-ask would be great for the broker but signals something
    // wrong -- the caller / LLM didn't actually book at our rate, so
    // we block to prevent a misrecorded booking.
    const result = evaluateBookability(load({ loadboard_rate: 2000 }), 2500)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('rate_out_of_bounds')
  })

  it('rejects a load already in `booked` status as `already_booked` (idempotent)', () => {
    const result = evaluateBookability(load({ status: 'booked' }), 2000)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('already_booked')
      expect(result.loadboard_rate).toBe(2000)
    }
  })

  it('treats `expired` as load_not_bookable (not the same as already_booked)', () => {
    const result = evaluateBookability(load({ status: 'expired' }), 2000)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('load_not_bookable')
      expect(result.load_status).toBe('expired')
    }
  })

  it('allows `in_negotiation` (mid-haggle loads can still book)', () => {
    const result = evaluateBookability(load({ status: 'in_negotiation' }), 2000)
    expect(result.ok).toBe(true)
  })

  it('rejects an unknown future status rather than letting it through', () => {
    // Default-to-reject posture: a new Convex status column value
    // (e.g. `on_hold`) must not silently become bookable. Adding a
    // new bookable status is an explicit change to `evaluateBookability`.
    const result = evaluateBookability(load({ status: 'on_hold' }), 2000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('load_not_bookable')
  })

  it('short-circuits `already_booked` before checking the rate bounds', () => {
    // If a booked load has a bogus cached loadboard_rate we should
    // still say `already_booked`, not `rate_out_of_bounds`. The caller
    // treats `already_booked` as idempotent success; reporting a rate
    // error would confuse retry logic.
    const result = evaluateBookability(load({ status: 'booked' }), 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('already_booked')
  })
})
