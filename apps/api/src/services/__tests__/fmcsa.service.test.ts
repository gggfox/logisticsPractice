import { describe, expect, it } from 'vitest'
import { isFmcsaInvalidIdError, isFmcsaNotFound, normalizeCarrierId } from '../fmcsa.service.js'

/** Mirrors eligibility rules in `fmcsa.service.ts` (not exported from the module). */
function evaluateEligibility(carrier: {
  allowedToOperate: string
  statusCode: string
  oosDate?: string
}): { eligible: boolean; reason?: string } {
  if (carrier.allowedToOperate !== 'Y') {
    return { eligible: false, reason: 'Carrier is not authorized to operate' }
  }
  if (carrier.statusCode === 'X') {
    return { eligible: false, reason: 'Carrier has out-of-service order' }
  }
  if (carrier.oosDate) {
    const oosDate = new Date(carrier.oosDate)
    if (oosDate.getTime() > Date.now()) {
      return { eligible: false, reason: `Carrier has active OOS order until ${carrier.oosDate}` }
    }
  }
  return { eligible: true }
}

describe('evaluateEligibility', () => {
  it("carrier with allowedToOperate='Y' and no OOS is eligible", () => {
    const result = evaluateEligibility({
      allowedToOperate: 'Y',
      statusCode: 'A',
    })
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it("carrier with allowedToOperate='N' is not eligible", () => {
    const result = evaluateEligibility({
      allowedToOperate: 'N',
      statusCode: 'A',
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('Carrier is not authorized to operate')
  })

  it("carrier with statusCode='X' (out of service) is not eligible", () => {
    const result = evaluateEligibility({
      allowedToOperate: 'Y',
      statusCode: 'X',
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('Carrier has out-of-service order')
  })

  it('carrier with active oosDate in the future is not eligible', () => {
    const result = evaluateEligibility({
      allowedToOperate: 'Y',
      statusCode: 'A',
      oosDate: '2099-12-31T23:59:59.000Z',
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('active OOS order')
  })
})

describe('isFmcsaNotFound', () => {
  it('returns true for the actual FMCSA not-found shape', () => {
    expect(isFmcsaNotFound({ content: null, retrievalDate: '2026-04-18T20:36:25.368+0000' })).toBe(
      true,
    )
  })

  it('returns true for a bare { content: null } object', () => {
    expect(isFmcsaNotFound({ content: null })).toBe(true)
  })

  it('returns false for a populated content object', () => {
    expect(
      isFmcsaNotFound({
        content: { carrier: { legalName: 'Schneider National Carriers Inc' } },
      }),
    ).toBe(false)
  })

  it('returns false for an empty object without a content field', () => {
    expect(isFmcsaNotFound({})).toBe(false)
  })

  it('returns false for null, undefined, and primitive values', () => {
    expect(isFmcsaNotFound(null)).toBe(false)
    expect(isFmcsaNotFound(undefined)).toBe(false)
    expect(isFmcsaNotFound('content: null')).toBe(false)
    expect(isFmcsaNotFound(0)).toBe(false)
    expect(isFmcsaNotFound(false)).toBe(false)
  })
})

describe('normalizeCarrierId', () => {
  it('accepts a bare numeric identifier', () => {
    expect(normalizeCarrierId('264184')).toEqual({ kind: 'digits', digits: '264184' })
  })

  it("strips an 'MC-' prefix", () => {
    expect(normalizeCarrierId('MC-264184')).toEqual({ kind: 'digits', digits: '264184' })
  })

  it("strips an 'MC ' (space) prefix", () => {
    expect(normalizeCarrierId('MC 264184')).toEqual({ kind: 'digits', digits: '264184' })
  })

  it('handles lowercase mc with no separator', () => {
    expect(normalizeCarrierId('mc264184')).toEqual({ kind: 'digits', digits: '264184' })
  })

  it("strips a 'DOT-' prefix", () => {
    expect(normalizeCarrierId('DOT-54283')).toEqual({ kind: 'digits', digits: '54283' })
  })

  it('rejects the word unknown as invalid', () => {
    const result = normalizeCarrierId('unknown')
    expect(result.kind).toBe('invalid')
  })

  it('rejects an empty string as invalid', () => {
    const result = normalizeCarrierId('')
    expect(result).toEqual({ kind: 'invalid', reason: 'Empty identifier' })
  })

  it('rejects MC-abc (non-numeric after strip)', () => {
    const result = normalizeCarrierId('MC-abc')
    expect(result.kind).toBe('invalid')
  })

  it('rejects whitespace-only input as invalid', () => {
    const result = normalizeCarrierId('   ')
    expect(result).toEqual({ kind: 'invalid', reason: 'Empty identifier' })
  })
})

describe('isFmcsaInvalidIdError', () => {
  it('returns true for the stringified FMCSA error-id body', () => {
    expect(
      isFmcsaInvalidIdError({
        content: 'We encountered an error while processing your request. Error ID: 99E6451A',
      }),
    ).toBe(true)
  })

  it('returns false for a populated content object', () => {
    expect(
      isFmcsaInvalidIdError({
        content: { carrier: { legalName: 'Schneider National Carriers Inc' } },
      }),
    ).toBe(false)
  })

  it('returns false for { content: null }', () => {
    expect(isFmcsaInvalidIdError({ content: null })).toBe(false)
  })

  it('returns false for a string without the Error ID marker', () => {
    expect(isFmcsaInvalidIdError({ content: 'Some other string' })).toBe(false)
  })

  it('returns false for null, undefined, and primitives', () => {
    expect(isFmcsaInvalidIdError(null)).toBe(false)
    expect(isFmcsaInvalidIdError(undefined)).toBe(false)
    expect(isFmcsaInvalidIdError('Error ID: 123')).toBe(false)
  })
})
