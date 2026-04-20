import { describe, expect, it } from 'vitest'
import type { ClassifyCallInput } from '../../queues/index.js'
import type { HappyRobotCallRun } from '../../services/happyrobot.service.js'
import {
  mergeRunIntoInput,
  outcomeFromHrTag,
  resolveOutcome,
  stripDiagnosticFields,
} from '../classify-call.worker.js'

const baseInput: ClassifyCallInput = {
  call_id: 'sess-1',
  run_id: 'run-1',
  started_at: '2026-04-20T02:00:00.000Z',
  ended_at: '2026-04-20T02:10:00.000Z',
  status: 'completed',
}

function makeRun(overrides: Partial<HappyRobotCallRun> = {}): HappyRobotCallRun {
  return {
    transcript: '',
    speakers: undefined,
    extraction: {},
    classification: undefined,
    duration_seconds: undefined,
    started_at: undefined,
    ended_at: undefined,
    ...overrides,
  }
}

describe('outcomeFromHrTag', () => {
  it('maps HR `Success` tag to internal `booked`', () => {
    expect(outcomeFromHrTag('Success')).toBe('booked')
  })

  it('maps HR `Rate too high` tag to internal `declined`', () => {
    expect(outcomeFromHrTag('Rate too high')).toBe('declined')
  })

  it('maps HR `Not interested` tag to internal `declined`', () => {
    expect(outcomeFromHrTag('Not interested')).toBe('declined')
  })

  it('is case-insensitive and tolerates leading/trailing whitespace', () => {
    expect(outcomeFromHrTag('  success  ')).toBe('booked')
    expect(outcomeFromHrTag('RATE TOO HIGH')).toBe('declined')
  })

  it('returns undefined for unrecognized tags so the keyword scan runs', () => {
    expect(outcomeFromHrTag(undefined)).toBeUndefined()
    expect(outcomeFromHrTag('')).toBeUndefined()
    expect(outcomeFromHrTag('something else')).toBeUndefined()
  })
})

describe('mergeRunIntoInput', () => {
  it('backfills carrier_mc and load_id from HR extraction when webhook is empty', () => {
    const run = makeRun({
      extraction: {
        mc_number: '264184',
        reference_number: 'LOAD-1004',
      },
    })
    const merged = mergeRunIntoInput(baseInput, run)
    expect(merged.carrier_mc).toBe('264184')
    expect(merged.load_id).toBe('LOAD-1004')
    expect(merged.hr_run_fetched).toBe(true)
  })

  it('prefers webhook carrier_mc over HR extraction', () => {
    const run = makeRun({ extraction: { mc_number: '999999' } })
    const merged = mergeRunIntoInput({ ...baseInput, carrier_mc: '264184' }, run)
    expect(merged.carrier_mc).toBe('264184')
  })

  it('prefers webhook transcript over HR transcript and marks source', () => {
    const merged = mergeRunIntoInput(
      { ...baseInput, transcript: 'webhook transcript' },
      makeRun({ transcript: 'hr transcript' }),
    )
    expect(merged.transcript).toBe('webhook transcript')
    expect(merged.transcript_source).toBe('webhook')
  })

  it('falls back to HR transcript when webhook transcript is empty', () => {
    const merged = mergeRunIntoInput(
      { ...baseInput, transcript: '' },
      makeRun({ transcript: 'hr transcript' }),
    )
    expect(merged.transcript).toBe('hr transcript')
    expect(merged.transcript_source).toBe('hr_api')
  })

  it('reports transcript_source="none" when no transcript is available', () => {
    const merged = mergeRunIntoInput(baseInput, null)
    expect(merged.transcript).toBe('')
    expect(merged.transcript_source).toBe('none')
    expect(merged.hr_run_fetched).toBe(false)
  })

  it('uses HR classification tag when present', () => {
    const run = makeRun({ classification: { tag: 'Success' } })
    const merged = mergeRunIntoInput(baseInput, run)
    expect(merged.hr_classify_tag).toBe('Success')
  })

  it('falls back to carrier_mc="unknown" when neither webhook nor extraction has it', () => {
    const merged = mergeRunIntoInput(baseInput, makeRun())
    expect(merged.carrier_mc).toBe('unknown')
    expect(merged.load_id).toBeUndefined()
  })

  it('pulls duration_seconds from HR run when webhook lacks it', () => {
    const merged = mergeRunIntoInput(baseInput, makeRun({ duration_seconds: 42 }))
    expect(merged.duration_seconds).toBe(42)
  })

  it('leaves existing behavior intact when HR run is null', () => {
    const merged = mergeRunIntoInput(
      {
        ...baseInput,
        carrier_mc: '264184',
        load_id: 'LOAD-1000',
        transcript: 'carrier: sounds good',
      },
      null,
    )
    expect(merged.carrier_mc).toBe('264184')
    expect(merged.load_id).toBe('LOAD-1000')
    expect(merged.transcript).toBe('carrier: sounds good')
    expect(merged.transcript_source).toBe('webhook')
    expect(merged.hr_run_fetched).toBe(false)
  })

  it('prefers webhook extracted_data over HR extraction', () => {
    const merged = mergeRunIntoInput(
      { ...baseInput, extracted_data: { mc_number: '111' } },
      makeRun({ extraction: { mc_number: '222' } }),
    )
    expect(merged.carrier_mc).toBe('111')
  })
})

describe('stripDiagnosticFields', () => {
  it('removes run_id and hr_run_fetched but leaves every other field intact', () => {
    const input = {
      call_id: 'sess-1',
      carrier_mc: '264184',
      load_id: 'LOAD-1004',
      transcript: 'carrier: sounds good',
      speakers: [{ role: 'carrier', text: 'sounds good' }],
      outcome: 'booked',
      negotiation_rounds: 1,
      final_rate: 2100,
      started_at: '2026-04-20T02:00:00.000Z',
      ended_at: '2026-04-20T02:10:00.000Z',
      duration_seconds: 600,
      run_id: 'run-1',
      hr_run_fetched: true,
    }
    const stripped = stripDiagnosticFields(input)
    expect(stripped).not.toHaveProperty('run_id')
    expect(stripped).not.toHaveProperty('hr_run_fetched')
    expect(stripped.call_id).toBe('sess-1')
    expect(stripped.carrier_mc).toBe('264184')
    expect(stripped.load_id).toBe('LOAD-1004')
    expect(stripped.transcript).toBe('carrier: sounds good')
    expect(stripped.outcome).toBe('booked')
    expect(stripped.negotiation_rounds).toBe(1)
    expect(stripped.final_rate).toBe(2100)
    expect(stripped.duration_seconds).toBe(600)
    expect(stripped.started_at).toBe('2026-04-20T02:00:00.000Z')
    expect(stripped.ended_at).toBe('2026-04-20T02:10:00.000Z')
    expect(stripped.speakers).toEqual([{ role: 'carrier', text: 'sounds good' }])
  })

  it('is a no-op when the input never had diagnostic fields', () => {
    const input = {
      call_id: 'sess-2',
      carrier_mc: 'unknown',
      transcript: '',
      negotiation_rounds: 0,
      started_at: '2026-04-20T02:00:00.000Z',
    }
    expect(stripDiagnosticFields(input)).toEqual(input)
  })
})

describe('resolveOutcome', () => {
  const baseArgs = {
    ready: true,
    isFinalAttempt: false,
    booking_decision: undefined,
    hr_classify_tag: undefined,
    status: 'completed',
    transcript: '',
    load_id: 'LOAD-1002',
    carrier_mc: '264184',
  } as const

  it('drops when extraction never arrived on the final attempt', () => {
    expect(resolveOutcome({ ...baseArgs, ready: false, isFinalAttempt: true })).toBe('dropped')
  })

  it('booked when HR Extract booking_decision says "yes" (strongest signal)', () => {
    // Even an explicit `Not interested` classify tag is overridden by a
    // concrete `booking_decision: yes` from HR's Extract node.
    expect(
      resolveOutcome({
        ...baseArgs,
        booking_decision: 'yes',
        hr_classify_tag: 'Not interested',
      }),
    ).toBe('booked')
  })

  it('falls through to HR Classify tag when booking_decision is absent', () => {
    expect(resolveOutcome({ ...baseArgs, hr_classify_tag: 'Success' })).toBe('booked')
    expect(resolveOutcome({ ...baseArgs, hr_classify_tag: 'Rate too high' })).toBe('declined')
  })

  it('falls through to keyword scan when both booking_decision and tag are absent', () => {
    expect(resolveOutcome({ ...baseArgs, transcript: 'carrier: accepted at 2100' })).toBe('booked')
  })

  it('declined when load and carrier are known but no booking signal', () => {
    expect(resolveOutcome({ ...baseArgs })).toBe('declined')
  })

  it('no_match when we have a carrier but no load_id', () => {
    expect(resolveOutcome({ ...baseArgs, load_id: undefined })).toBe('no_match')
  })

  it('dropped when neither load nor a real MC are present', () => {
    expect(resolveOutcome({ ...baseArgs, load_id: undefined, carrier_mc: 'unknown' })).toBe(
      'dropped',
    )
  })

  it('`booking_decision: "no"` does NOT force `declined` -- tag / scan still decide', () => {
    // A "no" is a negative signal, not a hard override. HR's Classify tag
    // or the keyword scan can still upgrade to `booked` if they contradict
    // (e.g. a buggy Extract against an obviously-successful transcript).
    expect(
      resolveOutcome({
        ...baseArgs,
        booking_decision: 'no',
        hr_classify_tag: 'Success',
      }),
    ).toBe('booked')
  })
})
