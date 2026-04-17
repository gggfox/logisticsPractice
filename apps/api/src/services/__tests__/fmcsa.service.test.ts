import { describe, expect, it } from 'vitest'

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
