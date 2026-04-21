import { describe, expect, it } from 'vitest'
import {
  HappyRobotCallRunSchema,
  HappyRobotRunResponseSchema,
  normalizeCallRun,
  normalizeRun,
} from '../happyrobot.service.js'

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

describe('normalizeRun — events-shape from /api/v1/runs/:run_id', () => {
  it('pulls classification tag off an AI-Classify event when top-level is absent', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        id: 'run-abc',
        session_id: 'sess-1',
        events: [
          { name: 'Inbound Voice Agent', data: { transcript: 'agent: hi\ncarrier: hey' } },
          { name: 'Classify', data: { tag: 'Success' } },
        ],
      }),
    )
    expect(normalized.classification).toStrictEqual({ tag: 'Success' })
    expect(normalized.transcript).toBe('agent: hi\ncarrier: hey')
  })

  it('pulls extraction off an Extract event when top-level is absent', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            name: 'AI Extract',
            data: { mc_number: '264184', reference_number: 'LOAD-1004' },
          },
        ],
      }),
    )
    expect(normalized.extraction.mc_number).toBe('264184')
    expect(normalized.extraction.reference_number).toBe('LOAD-1004')
  })

  it('reads voice agent speakers/transcript from an event payload', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            name: 'Voice Agent',
            data: {
              speakers: [
                { role: 'agent', text: 'hi' },
                { role: 'carrier', text: 'hey' },
              ],
            },
          },
        ],
      }),
    )
    expect(normalized.speakers).toStrictEqual([
      { role: 'agent', text: 'hi' },
      { role: 'carrier', text: 'hey' },
    ])
    expect(normalized.transcript).toBe('agent: hi\ncarrier: hey')
  })

  it('prefers top-level fields over event payloads when both are present', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        transcript: 'from top-level',
        classification: { tag: 'Rate too high' },
        extraction: { mc_number: 'top' },
        events: [
          { name: 'Voice Agent', data: { transcript: 'from event' } },
          { name: 'Classify', data: { tag: 'Success' } },
          { name: 'Extract', data: { mc_number: 'event' } },
        ],
      }),
    )
    expect(normalized.transcript).toBe('from top-level')
    expect(normalized.classification).toStrictEqual({ tag: 'Rate too high' })
    expect(normalized.extraction.mc_number).toBe('top')
  })

  it('falls back to the aggregate `output` map for classification and extraction', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        output: {
          classification_tag: 'Not interested',
          mc_number: '264184',
        },
      }),
    )
    expect(normalized.classification).toStrictEqual({ tag: 'Not interested' })
    expect(normalized.extraction.mc_number).toBe('264184')
  })

  it('accepts an empty events array without throwing', () => {
    expect(() => HappyRobotRunResponseSchema.parse({ events: [] })).not.toThrow()
    const normalized = normalizeRun(HappyRobotRunResponseSchema.parse({ events: [] }))
    expect(normalized.transcript).toBe('')
    expect(normalized.classification).toBeUndefined()
    expect(normalized.extraction).toStrictEqual({})
  })

  it('matches event names case-insensitively and tolerates whitespace', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [{ name: '  ai-classify  ', data: { tag: 'Success' } }],
      }),
    )
    expect(normalized.classification).toStrictEqual({ tag: 'Success' })
  })
})

describe('normalizeRun — live HR shape (output.response nesting)', () => {
  // HR's actual /api/v1/runs/:id shape puts the AI-node LLM output
  // under `output.response`, not at the top of the event data. A run
  // captured off `gggfox` workflow v9 verified this -- the original
  // normalizer couldn't see the tag and returned `classification:
  // undefined`, masking stale outputs as legitimately absent.

  it('reads classification from Classify event output.response.classification', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            integration_name: 'AI',
            event_name: 'Classify',
            output: {
              input: 'agent: hi\ncarrier: Book it.',
              response: {
                classification: 'Success',
                reasoning: 'Carrier said "Book it."',
              },
            },
          },
        ],
      }),
    )
    expect(normalized.classification).toStrictEqual({ tag: 'Success' })
  })

  it('reads booking_decision from Extract event output.response', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            integration_name: 'AI',
            event_name: 'Extract',
            output: {
              input: 'agent: hi\ncarrier: Book it.',
              response: {
                mc_number: '264184',
                booking_decision: 'yes',
                final_rate: '1661',
                reference_number: 'LOAD-1003',
              },
            },
          },
        ],
      }),
    )
    expect(normalized.extraction.booking_decision).toBe('yes')
    expect(normalized.extraction.final_rate).toBe('1661')
    expect(normalized.extraction.mc_number).toBe('264184')
  })

  it('synthesizes transcript from session.messages when no flat transcript exists', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            type: 'session',
            duration: 144,
            messages: [
              { role: 'assistant', content: 'How can I help?' },
              { role: 'user', content: 'Load 1004.' },
              { role: 'tool', content: '{"load_id":"LOAD-1004"}' },
              { role: 'user', content: 'Book it.' },
              { role: 'event', content: 'user_joined' },
              {
                role: 'user',
                content: '<Thoughts>Try to resume the conversation.</Thoughts>.',
              },
              { role: 'assistant', content: 'Thanks for booking with us!' },
            ],
          },
        ],
      }),
    )
    expect(normalized.transcript).toContain('Book it.')
    expect(normalized.transcript).toContain('Thanks for booking with us!')
    // Tool + event + Thoughts entries must not pollute the keyword scan.
    expect(normalized.transcript).not.toContain('user_joined')
    expect(normalized.transcript).not.toContain('Thoughts')
    expect(normalized.transcript).not.toContain('LOAD-1004')
    expect(normalized.duration_seconds).toBe(144)
    expect(normalized.speakers?.length).toBeGreaterThan(0)
  })

  it('discards stale Classify tag when input was an unresolved @transcript template', () => {
    // Reproduces the current gggfox v9 bug: Classify ran the moment
    // its `@transcript` input was referenced, before the Voice Agent
    // populated it. HR's variable resolver passed the literal string
    // "@transcript" to the LLM, which returned "Not interested". The
    // worker must treat this as absent so the keyword scan runs
    // against the real session transcript instead.
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            integration_name: 'AI',
            event_name: 'Classify',
            output: {
              input: '@transcript',
              response: { classification: 'Not interested' },
            },
          },
        ],
      }),
    )
    expect(normalized.classification).toBeUndefined()
  })

  it('discards stale Extract output and returns empty extraction', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            integration_name: 'AI',
            event_name: 'Extract',
            output: {
              input: '@transcript @duration',
              response: { booking_decision: 'no', mc_number: '' },
            },
          },
        ],
      }),
    )
    // An empty extraction lets webhook-level booking_decision / the
    // negotiation ledger drive the outcome instead of a hallucinated "no".
    expect(normalized.extraction).toStrictEqual({})
  })

  it('honors a non-stale Classify event even when a sibling Extract was stale', () => {
    const normalized = normalizeRun(
      HappyRobotRunResponseSchema.parse({
        events: [
          {
            integration_name: 'AI',
            event_name: 'Classify',
            output: {
              input: 'agent: hi\ncarrier: Book it.',
              response: { classification: 'Success' },
            },
          },
          {
            integration_name: 'AI',
            event_name: 'Extract',
            output: {
              input: '@transcript',
              response: { booking_decision: 'no' },
            },
          },
        ],
      }),
    )
    expect(normalized.classification).toStrictEqual({ tag: 'Success' })
    expect(normalized.extraction).toStrictEqual({})
  })
})
