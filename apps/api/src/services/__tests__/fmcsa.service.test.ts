import { describe, expect, it } from 'vitest'
import { isFmcsaNotFound } from '../fmcsa.service.js'

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
