import { describe, expect, it } from 'vitest'
import { LoadSchema, LoadSearchParamsSchema } from '../load.schema.js'

const validLoad = {
  load_id: 'LOAD-0001',
  origin: 'Dallas, TX',
  destination: 'Chicago, IL',
  pickup_datetime: '2026-04-20T08:00:00.000Z',
  delivery_datetime: '2026-04-22T08:00:00.000Z',
  equipment_type: 'dry_van' as const,
  loadboard_rate: 2500,
  notes: '',
  weight: 40000,
  commodity_type: 'General Freight',
  num_of_pieces: 24,
  miles: 920,
  dimensions: '53ft',
  status: 'available' as const,
}

describe('LoadSchema', () => {
  it('accepts a valid load', () => {
    const result = LoadSchema.safeParse(validLoad)
    expect(result.success).toBe(true)
  })

  it('rejects missing required fields', () => {
    const result = LoadSchema.safeParse({ load_id: 'X' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid equipment type', () => {
    const result = LoadSchema.safeParse({ ...validLoad, equipment_type: 'submarine' })
    expect(result.success).toBe(false)
  })

  it('rejects negative loadboard_rate', () => {
    const result = LoadSchema.safeParse({ ...validLoad, loadboard_rate: -100 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid datetime format', () => {
    const result = LoadSchema.safeParse({ ...validLoad, pickup_datetime: 'not-a-date' })
    expect(result.success).toBe(false)
  })

  it('defaults status to available', () => {
    const { status, ...noStatus } = validLoad
    const result = LoadSchema.parse(noStatus)
    expect(result.status).toBe('available')
  })
})

describe('LoadSearchParamsSchema', () => {
  it('accepts all optional fields', () => {
    const result = LoadSearchParamsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts partial params', () => {
    const result = LoadSearchParamsSchema.safeParse({ origin: 'Dallas', equipment_type: 'reefer' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid equipment type', () => {
    const result = LoadSearchParamsSchema.safeParse({ equipment_type: 'unknown' })
    expect(result.success).toBe(false)
  })
})
