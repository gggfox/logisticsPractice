import { describe, expect, it } from 'vitest'

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
  it('marks authorized carrier with no OOS as eligible', () => {
    const result = evaluateEligibility({ allowedToOperate: 'Y', statusCode: 'A' })
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('rejects carrier not authorized to operate', () => {
    const result = evaluateEligibility({ allowedToOperate: 'N', statusCode: 'A' })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('not authorized')
  })

  it('rejects carrier with out-of-service status code', () => {
    const result = evaluateEligibility({ allowedToOperate: 'Y', statusCode: 'X' })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('out-of-service')
  })

  it('rejects carrier with future OOS date', () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString()
    const result = evaluateEligibility({
      allowedToOperate: 'Y',
      statusCode: 'A',
      oosDate: futureDate,
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('active OOS order')
  })

  it('allows carrier with expired OOS date', () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString()
    const result = evaluateEligibility({
      allowedToOperate: 'Y',
      statusCode: 'A',
      oosDate: pastDate,
    })
    expect(result.eligible).toBe(true)
  })
})
