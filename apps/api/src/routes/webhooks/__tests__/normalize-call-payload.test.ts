import { describe, expect, it } from 'vitest'
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
