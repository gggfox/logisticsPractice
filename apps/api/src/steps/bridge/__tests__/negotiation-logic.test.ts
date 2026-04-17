import { MAX_NEGOTIATION_ROUNDS, OFFER_ACCEPT_MARGIN_PERCENT } from '@carrier-sales/shared'
import { describe, expect, it } from 'vitest'

function calculateCounterOffer(loadboardRate: number, offeredRate: number, round: number): number {
  const gap = loadboardRate - offeredRate
  const concessionFactor = 0.3 + round * 0.15
  return Math.round(loadboardRate - gap * concessionFactor)
}

function isAcceptable(offeredRate: number, loadboardRate: number): boolean {
  const minAcceptable = loadboardRate * (1 - OFFER_ACCEPT_MARGIN_PERCENT / 100)
  return offeredRate >= minAcceptable
}

describe('calculateCounterOffer', () => {
  const loadboardRate = 2500

  it('round 1 counter is closer to loadboard rate', () => {
    const counter = calculateCounterOffer(loadboardRate, 2000, 1)
    expect(counter).toBeGreaterThan(2000)
    expect(counter).toBeLessThan(loadboardRate)
  })

  it('round 2 concedes more than round 1', () => {
    const counter1 = calculateCounterOffer(loadboardRate, 2000, 1)
    const counter2 = calculateCounterOffer(loadboardRate, 2000, 2)
    expect(counter2).toBeLessThan(counter1)
  })

  it('round 3 concedes the most', () => {
    const counter2 = calculateCounterOffer(loadboardRate, 2000, 2)
    const counter3 = calculateCounterOffer(loadboardRate, 2000, 3)
    expect(counter3).toBeLessThan(counter2)
  })

  it('counter never drops below offered rate when gap is reasonable', () => {
    const counter = calculateCounterOffer(loadboardRate, 2300, 3)
    expect(counter).toBeGreaterThanOrEqual(2300)
  })
})

describe('isAcceptable', () => {
  const loadboardRate = 2500
  const margin = OFFER_ACCEPT_MARGIN_PERCENT / 100

  it('accepts offer at loadboard rate', () => {
    expect(isAcceptable(2500, loadboardRate)).toBe(true)
  })

  it('accepts offer above loadboard rate', () => {
    expect(isAcceptable(2600, loadboardRate)).toBe(true)
  })

  it('accepts offer at exact margin boundary', () => {
    const boundary = loadboardRate * (1 - margin)
    expect(isAcceptable(boundary, loadboardRate)).toBe(true)
  })

  it('rejects offer below margin', () => {
    const belowMargin = loadboardRate * (1 - margin) - 1
    expect(isAcceptable(belowMargin, loadboardRate)).toBe(false)
  })
})

describe('negotiation round limits', () => {
  it('MAX_NEGOTIATION_ROUNDS is 3', () => {
    expect(MAX_NEGOTIATION_ROUNDS).toBe(3)
  })
})
