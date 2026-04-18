import { describe, expect, it } from 'vitest'
import { CarrierSchema, FMCSACarrierResponseSchema } from '../carrier.schema.js'

const validCarrier = {
  mc_number: '123456',
  legal_name: 'Test Carrier LLC',
  dot_number: '7890',
  operating_status: 'AUTHORIZED',
  is_eligible: true,
  verified_at: '2026-04-14T12:00:00.000Z',
}

describe('CarrierSchema', () => {
  it('accepts a valid carrier', () => {
    const result = CarrierSchema.safeParse(validCarrier)
    expect(result.success).toBe(true)
  })

  it('rejects empty mc_number', () => {
    const result = CarrierSchema.safeParse({ ...validCarrier, mc_number: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const result = CarrierSchema.safeParse({ mc_number: '123' })
    expect(result.success).toBe(false)
  })

  it('allows optional fields to be omitted', () => {
    const result = CarrierSchema.safeParse(validCarrier)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.safety_rating).toBeUndefined()
    }
  })
})

describe('FMCSACarrierResponseSchema', () => {
  it('validates nested FMCSA response structure', () => {
    const result = FMCSACarrierResponseSchema.safeParse({
      content: {
        carrier: {
          legalName: 'Test Carrier LLC',
          dotNumber: '7890',
          allowedToOperate: 'Y',
          statusCode: 'A',
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing nested carrier object', () => {
    const result = FMCSACarrierResponseSchema.safeParse({ content: {} })
    expect(result.success).toBe(false)
  })

  it('accepts numeric dotNumber and coerces to string', () => {
    const result = FMCSACarrierResponseSchema.safeParse({
      content: {
        carrier: {
          legalName: 'Schneider National Carriers Inc',
          dotNumber: 264184,
          allowedToOperate: 'Y',
          statusCode: 'A',
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content.carrier.dotNumber).toBe('264184')
    }
  })

  it('accepts null for commonly-null optional fields and normalizes to undefined', () => {
    const result = FMCSACarrierResponseSchema.safeParse({
      content: {
        carrier: {
          legalName: 'Example Carrier LLC',
          dotNumber: '7890',
          mcNumber: null,
          allowedToOperate: 'Y',
          safetyRating: null,
          phone: null,
          totalDrivers: null,
          totalPowerUnits: null,
          statusCode: 'A',
          oosDate: null,
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      const { carrier } = result.data.content
      expect(carrier.oosDate).toBeUndefined()
      expect(carrier.safetyRating).toBeUndefined()
      expect(carrier.phone).toBeUndefined()
      expect(carrier.totalDrivers).toBeUndefined()
      expect(carrier.totalPowerUnits).toBeUndefined()
      expect(carrier.mcNumber).toBeUndefined()
    }
  })
})
