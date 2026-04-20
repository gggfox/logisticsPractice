import { describe, expect, it } from 'vitest'
import {
  extractBookingDecision,
  extractFinalRate,
  extractReferenceNumber,
  isPlausibleLoadId,
  isValidMcFormat,
} from '../validation.js'

describe('isValidMcFormat', () => {
  it('accepts 1-8 digit MC numbers', () => {
    expect(isValidMcFormat('1')).toBe(true)
    expect(isValidMcFormat('264184')).toBe(true)
    expect(isValidMcFormat('12345678')).toBe(true)
  })

  it('rejects 9+ digit MC numbers (format bound)', () => {
    expect(isValidMcFormat('123456789')).toBe(false)
  })

  it('rejects non-digit strings', () => {
    expect(isValidMcFormat('MC264184')).toBe(false)
    expect(isValidMcFormat('264-184')).toBe(false)
    expect(isValidMcFormat('264 184')).toBe(false)
    expect(isValidMcFormat('abc')).toBe(false)
  })

  it('rejects undefined, null, and empty string', () => {
    expect(isValidMcFormat(undefined)).toBe(false)
    expect(isValidMcFormat(null)).toBe(false)
    expect(isValidMcFormat('')).toBe(false)
  })

  it('rejects the `unknown` sentinel so markBooked never writes it', () => {
    expect(isValidMcFormat('unknown')).toBe(false)
  })
})

describe('isPlausibleLoadId', () => {
  it('accepts canonical load ids', () => {
    expect(isPlausibleLoadId('LOAD-1002')).toBe(true)
    expect(isPlausibleLoadId('ABC12345')).toBe(true)
  })

  it('rejects unresolved HappyRobot templates', () => {
    expect(isPlausibleLoadId('@load_id')).toBe(false)
    expect(isPlausibleLoadId('@reference_number')).toBe(false)
    expect(isPlausibleLoadId('{{load_id}}')).toBe(false)
    expect(isPlausibleLoadId(':call_id')).toBe(false)
  })

  it('rejects empty / nullish / non-string', () => {
    expect(isPlausibleLoadId('')).toBe(false)
    expect(isPlausibleLoadId(undefined)).toBe(false)
    expect(isPlausibleLoadId(null)).toBe(false)
  })
})

describe('extractBookingDecision', () => {
  it('normalizes yes/no in any casing', () => {
    expect(extractBookingDecision({ booking_decision: 'YES' })).toBe('yes')
    expect(extractBookingDecision({ booking_decision: '  yes  ' })).toBe('yes')
    expect(extractBookingDecision({ booking_decision: 'No' })).toBe('no')
  })

  it('treats `true`/`false` strings as yes/no (LLM coercion)', () => {
    expect(extractBookingDecision({ booking_decision: 'true' })).toBe('yes')
    expect(extractBookingDecision({ booking_decision: 'false' })).toBe('no')
  })

  it('returns undefined for empty / unexpected values', () => {
    expect(extractBookingDecision({ booking_decision: '' })).toBeUndefined()
    expect(extractBookingDecision({ booking_decision: 'maybe' })).toBeUndefined()
    expect(extractBookingDecision({ booking_decision: 42 })).toBeUndefined()
    expect(extractBookingDecision({})).toBeUndefined()
    expect(extractBookingDecision(undefined)).toBeUndefined()
    expect(extractBookingDecision(null)).toBeUndefined()
  })
})

describe('extractFinalRate', () => {
  it('accepts positive numbers unchanged', () => {
    expect(extractFinalRate({ final_rate: 2241 })).toBe(2241)
  })

  it('parses numeric strings (HR Extract stringifies everything)', () => {
    expect(extractFinalRate({ final_rate: '2100' })).toBe(2100)
    expect(extractFinalRate({ final_rate: '2100.50' })).toBe(2100.5)
  })

  it('returns undefined for empty, zero, negative, or non-numeric', () => {
    expect(extractFinalRate({ final_rate: '' })).toBeUndefined()
    expect(extractFinalRate({ final_rate: 0 })).toBeUndefined()
    expect(extractFinalRate({ final_rate: -100 })).toBeUndefined()
    expect(extractFinalRate({ final_rate: 'no' })).toBeUndefined()
    expect(extractFinalRate({})).toBeUndefined()
    expect(extractFinalRate(undefined)).toBeUndefined()
  })
})

describe('extractReferenceNumber', () => {
  it('returns the trimmed reference_number', () => {
    expect(extractReferenceNumber({ reference_number: 'LOAD-1002' })).toBe('LOAD-1002')
    expect(extractReferenceNumber({ reference_number: '  LOAD-1002  ' })).toBe('LOAD-1002')
  })

  it('returns undefined for empty / non-string / missing', () => {
    expect(extractReferenceNumber({ reference_number: '' })).toBeUndefined()
    expect(extractReferenceNumber({ reference_number: 42 })).toBeUndefined()
    expect(extractReferenceNumber({})).toBeUndefined()
    expect(extractReferenceNumber(undefined)).toBeUndefined()
  })
})
