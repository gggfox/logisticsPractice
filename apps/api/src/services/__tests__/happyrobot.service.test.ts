import { describe, expect, it } from 'vitest'
import { HappyRobotCallRunSchema, normalizeCallRun } from '../happyrobot.service.js'

describe('HappyRobotCallRunSchema', () => {
  it('parses the full documented shape', () => {
    const parsed = HappyRobotCallRunSchema.parse({
      transcript: 'agent: hi\ncarrier: hey',
      speakers: [
        { role: 'agent', text: 'hi' },
        { role: 'carrier', text: 'hey' },
      ],
      extraction: { mc_number: '264184', reference_number: 'LOAD-1000' },
      classification: { tag: 'Success' },
      duration_seconds: 123,
      started_at: '2026-04-20T02:00:00.000Z',
      ended_at: '2026-04-20T02:02:03.000Z',
    })
    expect(parsed.transcript).toBe('agent: hi\ncarrier: hey')
    expect(parsed.extraction?.mc_number).toBe('264184')
    expect(parsed.classification?.tag).toBe('Success')
    expect(parsed.duration_seconds).toBe(123)
  })

  it('accepts an empty object (every field is optional)', () => {
    expect(() => HappyRobotCallRunSchema.parse({})).not.toThrow()
  })

  it('preserves unknown top-level fields via passthrough', () => {
    const parsed = HappyRobotCallRunSchema.parse({
      transcript: 'x',
      unexpected_field: 'should survive',
    }) as Record<string, unknown>
    expect(parsed.unexpected_field).toBe('should survive')
  })

  it('rejects a non-string transcript', () => {
    expect(() => HappyRobotCallRunSchema.parse({ transcript: 123 })).toThrow()
  })

  it('rejects a non-object classification', () => {
    expect(() => HappyRobotCallRunSchema.parse({ classification: 'Success' })).toThrow()
  })
})

describe('normalizeCallRun', () => {
  it('maps a full HR response into the classify-worker shape', () => {
    const normalized = normalizeCallRun(
      HappyRobotCallRunSchema.parse({
        transcript: 'agent: hi\ncarrier: hey',
        speakers: [
          { role: 'agent', text: 'hi' },
          { role: 'carrier', text: 'hey' },
        ],
        extraction: { mc_number: '264184', reference_number: 'LOAD-1000' },
        classification: { tag: 'Success' },
        duration_seconds: 123,
      }),
    )
    expect(normalized.transcript).toBe('agent: hi\ncarrier: hey')
    expect(normalized.speakers).toStrictEqual([
      { role: 'agent', text: 'hi' },
      { role: 'carrier', text: 'hey' },
    ])
    expect(normalized.extraction.mc_number).toBe('264184')
    expect(normalized.classification).toStrictEqual({ tag: 'Success' })
    expect(normalized.duration_seconds).toBe(123)
  })

  it('falls back to extraction.transcript when top-level transcript is empty', () => {
    const normalized = normalizeCallRun(
      HappyRobotCallRunSchema.parse({
        transcript: '',
        extraction: { transcript: 'from extraction' },
      }),
    )
    expect(normalized.transcript).toBe('from extraction')
  })

  it('returns empty transcript and undefined speakers for a bare response', () => {
    const normalized = normalizeCallRun(HappyRobotCallRunSchema.parse({}))
    expect(normalized.transcript).toBe('')
    expect(normalized.speakers).toBeUndefined()
    expect(normalized.extraction).toStrictEqual({})
    expect(normalized.classification).toBeUndefined()
  })

  it('prefers `extraction` over `extracted_data` when both are present', () => {
    const normalized = normalizeCallRun(
      HappyRobotCallRunSchema.parse({
        extraction: { mc_number: 'from-extraction' },
        extracted_data: { mc_number: 'from-extracted-data' },
      }),
    )
    expect(normalized.extraction.mc_number).toBe('from-extraction')
  })

  it('falls back to `extracted_data` when `extraction` is absent', () => {
    const normalized = normalizeCallRun(
      HappyRobotCallRunSchema.parse({
        extracted_data: { reference_number: 'LOAD-1004' },
      }),
    )
    expect(normalized.extraction.reference_number).toBe('LOAD-1004')
  })

  it('surfaces a classification object with undefined tag when tag is missing', () => {
    const normalized = normalizeCallRun(HappyRobotCallRunSchema.parse({ classification: {} }))
    expect(normalized.classification).toStrictEqual({ tag: undefined })
  })

  it('extracts speakers from messages when no top-level speakers array is present', () => {
    const normalized = normalizeCallRun(
      HappyRobotCallRunSchema.parse({
        messages: [
          { speaker: 'agent', content: 'hi' },
          { speaker: 'carrier', content: 'hey' },
        ],
      }),
    )
    expect(normalized.speakers).toStrictEqual([
      { role: 'agent', text: 'hi' },
      { role: 'carrier', text: 'hey' },
    ])
  })
})
