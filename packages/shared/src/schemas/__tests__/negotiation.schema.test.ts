import { describe, expect, it } from 'vitest'
import {
  BookLoadRequestSchema,
  NegotiationRoundSchema,
  OfferRequestSchema,
} from '../negotiation.schema.js'

const validRound = {
  call_id: 'call-001',
  round: 1,
  offered_rate: 2000,
  accepted: false,
  timestamp: '2026-04-14T12:00:00.000Z',
}

describe('NegotiationRoundSchema', () => {
  it('accepts valid rounds 1 through 3', () => {
    for (const round of [1, 2, 3]) {
      const result = NegotiationRoundSchema.safeParse({ ...validRound, round })
      expect(result.success).toBe(true)
    }
  })

  it('rejects round > 3', () => {
    const result = NegotiationRoundSchema.safeParse({ ...validRound, round: 4 })
    expect(result.success).toBe(false)
  })

  it('rejects round < 1', () => {
    const result = NegotiationRoundSchema.safeParse({ ...validRound, round: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects negative offered_rate', () => {
    const result = NegotiationRoundSchema.safeParse({ ...validRound, offered_rate: -500 })
    expect(result.success).toBe(false)
  })

  it('allows optional counter_rate', () => {
    const result = NegotiationRoundSchema.safeParse({ ...validRound, counter_rate: 2200 })
    expect(result.success).toBe(true)
  })
})

describe('OfferRequestSchema', () => {
  it('requires all fields', () => {
    const result = OfferRequestSchema.safeParse({
      call_id: 'call-001',
      load_id: 'LOAD-0001',
      carrier_mc: '123456',
      offered_rate: 2000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing call_id', () => {
    const result = OfferRequestSchema.safeParse({
      load_id: 'LOAD-0001',
      carrier_mc: '123456',
      offered_rate: 2000,
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero offered_rate', () => {
    const result = OfferRequestSchema.safeParse({
      call_id: 'call-001',
      load_id: 'LOAD-0001',
      carrier_mc: '123456',
      offered_rate: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('BookLoadRequestSchema', () => {
  it('requires both agreed_rate and carrier_mc', () => {
    const result = BookLoadRequestSchema.safeParse({
      agreed_rate: 2241,
      carrier_mc: '264184',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a booking without carrier_mc (prevents unknown-carrier booked rows)', () => {
    const result = BookLoadRequestSchema.safeParse({ agreed_rate: 2241 })
    expect(result.success).toBe(false)
  })

  it('rejects a zero or negative agreed_rate', () => {
    const resultZero = BookLoadRequestSchema.safeParse({ agreed_rate: 0, carrier_mc: '264184' })
    const resultNeg = BookLoadRequestSchema.safeParse({ agreed_rate: -100, carrier_mc: '264184' })
    expect(resultZero.success).toBe(false)
    expect(resultNeg.success).toBe(false)
  })

  it('coerces a numeric carrier_mc from HappyRobot (which sends it unquoted)', () => {
    const result = BookLoadRequestSchema.safeParse({ agreed_rate: 2241, carrier_mc: 264184 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.carrier_mc).toBe('264184')
    }
  })
})
