import { describe, expect, it } from 'vitest'
import { normalizeCallEvent } from '../call-completed.js'
import {
  extractSpeakersFromPayload,
  isTerminalStatus,
  pickSpeakers,
  resolveTranscript,
  unwrapCloudEventPayload,
} from '../normalize-call-payload.js'

describe('pickSpeakers', () => {
  it('returns undefined when no candidate array is non-empty', () => {
    expect(pickSpeakers(undefined, null, [], 'not-an-array')).toBeUndefined()
  })

  it('passes through canonical `{role, text}` arrays', () => {
    const turns = pickSpeakers([
      { role: 'agent', text: 'Hello' },
      { role: 'carrier', text: 'Hi' },
    ])
    expect(turns).toStrictEqual([
      { role: 'agent', text: 'Hello' },
      { role: 'carrier', text: 'Hi' },
    ])
  })

  it('remaps `{speaker, content}` into canonical turns', () => {
    const turns = pickSpeakers([
      { speaker: 'agent', content: 'Hi there' },
      { speaker: 'carrier', content: 'Hey' },
    ])
    expect(turns).toStrictEqual([
      { role: 'agent', text: 'Hi there' },
      { role: 'carrier', text: 'Hey' },
    ])
  })

  it('drops items missing either role or text instead of defaulting', () => {
    const turns = pickSpeakers([
      { role: 'agent', text: 'Hello' },
      { role: 'agent' },
      { text: 'orphaned text' },
      { role: '', text: '' },
      { role: 'carrier', text: 'Hi' },
    ])
    expect(turns).toStrictEqual([
      { role: 'agent', text: 'Hello' },
      { role: 'carrier', text: 'Hi' },
    ])
  })

  it('returns the first non-empty candidate; later args are ignored', () => {
    const turns = pickSpeakers([], [{ role: 'a', text: 'first' }], [{ role: 'b', text: 'second' }])
    expect(turns).toStrictEqual([{ role: 'a', text: 'first' }])
  })
})

describe('extractSpeakersFromPayload', () => {
  it('reads `raw.speakers` first', () => {
    const turns = extractSpeakersFromPayload({
      speakers: [{ role: 'agent', text: 'from raw' }],
      extraction: { speakers: [{ role: 'agent', text: 'from extraction' }] },
    })
    expect(turns).toStrictEqual([{ role: 'agent', text: 'from raw' }])
  })

  it('falls back to `transcript.speakers` when raw.speakers missing', () => {
    const turns = extractSpeakersFromPayload({
      transcript: { speakers: [{ role: 'agent', text: 'nested' }] },
    })
    expect(turns).toStrictEqual([{ role: 'agent', text: 'nested' }])
  })

  it('ignores transcript when transcript is a plain string', () => {
    const turns = extractSpeakersFromPayload({
      transcript: 'agent: hi\ncarrier: hey',
    })
    expect(turns).toBeUndefined()
  })

  it('falls back to `extraction.speakers`', () => {
    const turns = extractSpeakersFromPayload({
      extraction: { speakers: [{ speaker: 'agent', content: 'from extraction' }] },
    })
    expect(turns).toStrictEqual([{ role: 'agent', text: 'from extraction' }])
  })

  it('falls back to `raw.messages`', () => {
    const turns = extractSpeakersFromPayload({
      messages: [{ speaker: 'carrier', content: 'from messages' }],
    })
    expect(turns).toStrictEqual([{ role: 'carrier', text: 'from messages' }])
  })

  it('returns undefined for fully-empty HappyRobot envelope', () => {
    const turns = extractSpeakersFromPayload({
      run_id: 'abc',
      session_id: 'def',
      status: 'completed',
    })
    expect(turns).toBeUndefined()
  })
})

describe('resolveTranscript', () => {
  it('prefers the raw string transcript', () => {
    const t = resolveTranscript({ transcript: 'plain text transcript' }, [
      { role: 'agent', text: 'should not win' },
    ])
    expect(t).toBe('plain text transcript')
  })

  it('falls back to extraction.transcript', () => {
    const t = resolveTranscript({ extraction: { transcript: 'from extraction' } }, undefined)
    expect(t).toBe('from extraction')
  })

  it('synthesizes "role: text" lines when only speakers are present', () => {
    const t = resolveTranscript({}, [
      { role: 'agent', text: 'Hi' },
      { role: 'carrier', text: 'Hey' },
    ])
    expect(t).toBe('agent: Hi\ncarrier: Hey')
  })

  it('returns empty string when nothing is available', () => {
    expect(resolveTranscript({}, undefined)).toBe('')
    expect(resolveTranscript({}, [])).toBe('')
  })

  it('treats an empty raw.transcript string as absent', () => {
    const t = resolveTranscript({ transcript: '' }, [{ role: 'agent', text: 'Hi' }])
    expect(t).toBe('agent: Hi')
  })
})

describe('unwrapCloudEventPayload — correlation-id skip guard', () => {
  it('returns undefined session_id and run_id when both are missing', () => {
    const raw = {
      specversion: '1.0',
      id: 'evt-no-ids',
      type: 'session.status_changed',
      data: {
        status: { current: 'completed' },
        org: 'acme',
      },
    }
    const out = unwrapCloudEventPayload(raw)
    expect(out.is_cloud_event).toBe(true)
    expect(out.session_id).toBeUndefined()
    expect(out.run_id).toBeUndefined()
    expect(out.status_current).toBe('completed')
  })
})

describe('unwrapCloudEventPayload', () => {
  it('unwraps a HappyRobot session.status_changed envelope', () => {
    const raw = {
      specversion: '1.0',
      id: 'evt-123',
      source: 'https://platform.happyrobot.ai',
      type: 'session.status_changed',
      time: '2026-04-20T02:34:49.485Z',
      datacontenttype: 'application/json',
      data: {
        schema_version: '2024-10-01',
        run_id: 'run-uuid',
        session_id: 'jd7day0t03gks4kasqj0vzkyy5852bbt',
        status: {
          previous: 'in-progress',
          current: 'completed',
          updated_at: '2026-04-20T02:34:49.000Z',
        },
      },
    }
    const out = unwrapCloudEventPayload(raw)
    expect(out.is_cloud_event).toBe(true)
    expect(out.cloudevent_type).toBe('session.status_changed')
    expect(out.event_time).toBe('2026-04-20T02:34:49.485Z')
    expect(out.session_id).toBe('jd7day0t03gks4kasqj0vzkyy5852bbt')
    expect(out.run_id).toBe('run-uuid')
    expect(out.status_current).toBe('completed')
    expect(out.status_previous).toBe('in-progress')
    expect(out.status_updated_at).toBe('2026-04-20T02:34:49.000Z')
    expect(out.inner).toBe(raw.data)
  })

  it('passes through the flat shape unchanged', () => {
    const raw = {
      call_id: 'call-abc',
      carrier_mc: '264184',
      status: 'completed',
      transcript: 'agent: hi',
    }
    const out = unwrapCloudEventPayload(raw)
    expect(out.is_cloud_event).toBe(false)
    expect(out.inner).toBe(raw)
    expect(out.cloudevent_type).toBeUndefined()
    expect(out.session_id).toBeUndefined()
    expect(out.run_id).toBeUndefined()
    expect(out.status_current).toBe('completed')
  })

  it('does not unwrap when data is not an object', () => {
    const raw = { specversion: '1.0', data: 'not-an-object' }
    const out = unwrapCloudEventPayload(raw)
    expect(out.is_cloud_event).toBe(false)
    expect(out.inner).toBe(raw)
  })

  it('does not unwrap when specversion is missing', () => {
    const raw = { data: { session_id: 'x' } }
    const out = unwrapCloudEventPayload(raw)
    expect(out.is_cloud_event).toBe(false)
    expect(out.inner).toBe(raw)
  })

  it('handles a flat `status` string on the inner payload', () => {
    const raw = { call_id: 'x', status: 'in-progress' }
    const out = unwrapCloudEventPayload(raw)
    expect(out.status_current).toBe('in-progress')
    expect(out.status_previous).toBeUndefined()
  })
})

describe('isTerminalStatus', () => {
  it.each(['completed', 'failed', 'canceled', 'missed', 'voicemail', 'busy'])(
    '`%s` is terminal',
    (status) => {
      expect(isTerminalStatus(status)).toBe(true)
    },
  )

  it.each(['queued', 'in-progress'])('`%s` is non-terminal', (status) => {
    expect(isTerminalStatus(status)).toBe(false)
  })

  it('treats `undefined` as terminal so flat-shape payloads still flow', () => {
    expect(isTerminalStatus(undefined)).toBe(true)
  })
})

describe('normalizeCallEvent', () => {
  it('pulls business fields out of the templated per-node webhook body', () => {
    // This is the body HR delivers from the Webhook node fired after
    // `AI Extract` (see docs/happyrobot-setup.md §9.1).
    const raw = {
      call_id: 'sess-abc',
      run_id: 'run-abc',
      carrier_mc: '264184',
      load_id: 'LOAD-1002',
      phone_number: '+15551234567',
      status: 'completed',
      started_at: '2026-04-20T22:00:00.000Z',
      ended_at: '2026-04-20T22:05:00.000Z',
      duration_seconds: 300,
      transcript: 'agent: booked.',
      extracted_data: {
        reference_number: 'LOAD-1002',
        mc_number: '264184',
        booking_decision: 'yes',
        final_rate: 2241,
      },
      classification: { tag: 'Success' },
    }
    const n = normalizeCallEvent(raw)
    expect(n.call_id).toBe('sess-abc')
    expect(n.status).toBe('completed')
    expect(n.carrier_mc).toBe('264184')
    expect(n.load_id).toBe('LOAD-1002')
    expect(n.duration_seconds).toBe(300)
    expect(n.phone_number).toBe('+15551234567')
    expect(n.booking_decision).toBe('yes')
    expect(n.final_rate_from_extraction).toBe(2241)
    expect(n.carrier_mc_valid).toBe(true)
    expect(n.load_id_plausible).toBe(true)
    expect(n.is_terminal).toBe(true)
  })

  it('preserves native CloudEvents envelope shape (no business data)', () => {
    const raw = {
      specversion: '1.0',
      type: 'session.status_changed',
      time: '2026-04-20T02:34:49.485Z',
      data: {
        run_id: 'run-uuid',
        session_id: 'session-uuid',
        status: {
          previous: 'in-progress',
          current: 'completed',
          updated_at: '2026-04-20T02:34:49.000Z',
        },
      },
    }
    const n = normalizeCallEvent(raw)
    // `session_id` wins over `run_id` for correlation so offer rows line up.
    expect(n.call_id).toBe('session-uuid')
    expect(n.carrier_mc).toBeUndefined()
    expect(n.load_id).toBeUndefined()
    expect(n.carrier_mc_valid).toBe(true) // no MC present = "not invalid"
    expect(n.load_id_plausible).toBe(true)
    expect(n.is_terminal).toBe(true)
    expect(n.booking_decision).toBeUndefined()
  })

  it('flags an LLM-invented non-digit carrier_mc as invalid', () => {
    const raw = {
      call_id: 'sess-1',
      carrier_mc: 'my number is 264184', // LLM hallucination
      load_id: 'LOAD-1002',
      status: 'completed',
    }
    const n = normalizeCallEvent(raw)
    expect(n.carrier_mc).toBe('my number is 264184')
    expect(n.carrier_mc_valid).toBe(false)
    expect(n.load_id_plausible).toBe(true)
  })

  it('flags an unresolved HR template as an implausible load_id', () => {
    const raw = {
      call_id: 'sess-1',
      carrier_mc: '264184',
      load_id: '@load_id', // HR template didn't resolve
      status: 'completed',
    }
    const n = normalizeCallEvent(raw)
    expect(n.load_id).toBe('@load_id')
    expect(n.load_id_plausible).toBe(false)
    expect(n.carrier_mc_valid).toBe(true)
  })

  it('pulls load_id from extracted_data.reference_number when not top-level', () => {
    const raw = {
      call_id: 'sess-1',
      status: 'completed',
      extracted_data: {
        reference_number: 'LOAD-1002',
        booking_decision: 'yes',
      },
    }
    const n = normalizeCallEvent(raw)
    expect(n.load_id).toBe('LOAD-1002')
    expect(n.booking_decision).toBe('yes')
  })

  it('pulls carrier_mc from variables.mc_number (older HR workflows)', () => {
    const raw = {
      call_id: 'sess-1',
      status: 'completed',
      variables: { mc_number: '264184' },
    }
    const n = normalizeCallEvent(raw)
    expect(n.carrier_mc).toBe('264184')
  })

  it('accepts top-level mc_number as a number (HR templated @mc_number)', () => {
    // Reproduces the sparse templated body we saw in prod when HR's
    // Webhook node templates `@mc_number` (numeric agent variable) at the
    // top level of the body. `pickString` used to reject the number and
    // `carrier_mc` ended up `undefined`, which the classify worker
    // defaulted to `"unknown"` -- every call dropped at the booking gate.
    const raw = {
      load_id: 'LOAD-1004',
      mc_number: 264184,
      session_id: '69d2a3b0-4be9-4ae0-997e-a9b19483c03e',
      offered_rate: '',
    }
    const n = normalizeCallEvent(raw)
    expect(n.call_id).toBe('69d2a3b0-4be9-4ae0-997e-a9b19483c03e')
    expect(n.carrier_mc).toBe('264184')
    expect(n.carrier_mc_valid).toBe(true)
    expect(n.load_id).toBe('LOAD-1004')
    expect(n.is_terminal).toBe(true)
  })

  it('rejects non-positive numeric mc_number as undefined', () => {
    const raw = {
      call_id: 'sess-1',
      status: 'completed',
      mc_number: 0,
    }
    const n = normalizeCallEvent(raw)
    expect(n.carrier_mc).toBeUndefined()
  })

  it('pulls reference_number from the top level (flat HR template)', () => {
    const raw = {
      session_id: 'sess-1',
      status: 'completed',
      mc_number: 264184,
      reference_number: 'LOAD-1005',
    }
    const n = normalizeCallEvent(raw)
    expect(n.load_id).toBe('LOAD-1005')
  })

  it('pulls booking_decision and final_rate from the top level', () => {
    const raw = {
      session_id: 'sess-1',
      status: 'completed',
      mc_number: 264184,
      load_id: 'LOAD-1004',
      booking_decision: 'yes',
      final_rate: 2100,
    }
    const n = normalizeCallEvent(raw)
    expect(n.booking_decision).toBe('yes')
    expect(n.final_rate_from_extraction).toBe(2100)
  })

  it('prefers nested extracted_data over top-level booking_decision', () => {
    const raw = {
      session_id: 'sess-1',
      status: 'completed',
      booking_decision: 'no',
      extracted_data: { booking_decision: 'yes', final_rate: 2100 },
    }
    const n = normalizeCallEvent(raw)
    expect(n.booking_decision).toBe('yes')
    expect(n.final_rate_from_extraction).toBe(2100)
  })
})
