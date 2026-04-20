import { z } from 'zod'
import { config } from '../config.js'
import {
  type SpeakerTurn,
  extractSpeakersFromPayload,
} from '../routes/webhooks/normalize-call-payload.js'

async function happyrobotFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${config.happyrobot.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.happyrobot.apiKey}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })

  // Not-found signals: 400 (bad id), 404 (missing), 422 (unprocessable id).
  // 401/403/429/5xx stay as throws -- those are our problems, not "call not found".
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return null
  }

  if (!response.ok) {
    // Capture a bounded body snippet for diagnostics so the next failure
    // surfaces the actual upstream shape. Path has no secrets in it; the
    // Authorization header is only on the request, never the response.
    let snippet = ''
    try {
      snippet = (await response.text()).slice(0, 200)
    } catch {
      // body already consumed or unreadable; keep snippet empty
    }
    const suffix = snippet ? ` -- ${snippet}` : ''
    throw new Error(`HappyRobot API error ${response.status}: ${response.statusText}${suffix}`)
  }

  return response.json()
}

export async function getCallTranscript(
  callId: string,
): Promise<{ transcript: string; speakers: Array<{ role: string; text: string }> } | null> {
  const data = (await happyrobotFetch(`/api/v1/calls/${callId}/transcript`)) as {
    transcript?: string
    speakers?: Array<{ role: string; text: string }>
  } | null

  if (data === null) {
    return null
  }

  return {
    transcript: data.transcript ?? '',
    speakers: data.speakers ?? [],
  }
}

export async function getCallDetails(callId: string): Promise<unknown> {
  return happyrobotFetch(`/api/v1/calls/${callId}`)
}

/**
 * Permissive schema for `GET /api/v1/calls/:call_id`. HappyRobot's response
 * shape is not contractually ours -- extra fields pass through, known fields
 * are parsed best-effort. `.passthrough()` preserves unknown keys so the
 * classify worker can mine them if HR adds something useful later.
 */
export const HappyRobotCallRunSchema = z
  .object({
    transcript: z.string().optional(),
    speakers: z.array(z.object({ role: z.string(), text: z.string() }).passthrough()).optional(),
    messages: z.array(z.record(z.unknown())).optional(),
    extraction: z.record(z.unknown()).optional(),
    extracted_data: z.record(z.unknown()).optional(),
    classification: z
      .object({
        tag: z.string().optional(),
      })
      .passthrough()
      .optional(),
    duration_seconds: z.number().optional(),
    started_at: z.string().optional(),
    ended_at: z.string().optional(),
  })
  .passthrough()

export type HappyRobotCallRunResponse = z.infer<typeof HappyRobotCallRunSchema>

export interface HappyRobotCallRun {
  transcript: string
  speakers: SpeakerTurn[] | undefined
  extraction: Record<string, unknown>
  classification: { tag: string | undefined } | undefined
  duration_seconds: number | undefined
  started_at: string | undefined
  ended_at: string | undefined
}

/**
 * Normalize an HR call-run response into the narrow shape the classify
 * worker needs. Exported for tests -- no network, no I/O, just shape mapping.
 */
export function normalizeCallRun(parsed: HappyRobotCallRunResponse): HappyRobotCallRun {
  const extraction = parsed.extraction ?? parsed.extracted_data ?? {}
  const speakers = extractSpeakersFromPayload(parsed as Record<string, unknown>)
  const transcriptDirect =
    typeof parsed.transcript === 'string' && parsed.transcript.length > 0
      ? parsed.transcript
      : undefined
  const extractionTranscript = extraction.transcript
  const transcriptFromExtraction =
    typeof extractionTranscript === 'string' && extractionTranscript.length > 0
      ? extractionTranscript
      : undefined
  const transcript = transcriptDirect ?? transcriptFromExtraction ?? ''

  const classification = parsed.classification
    ? { tag: typeof parsed.classification.tag === 'string' ? parsed.classification.tag : undefined }
    : undefined

  return {
    transcript,
    speakers,
    extraction,
    classification,
    duration_seconds: parsed.duration_seconds,
    started_at: parsed.started_at,
    ended_at: parsed.ended_at,
  }
}

/**
 * Fetch the full call-run record from HappyRobot and normalize it for the
 * classify worker. Returns `null` on 404 / bad id. No retries: BullMQ already
 * retries the worker on transient failure.
 */
export async function getCallRun(callId: string): Promise<HappyRobotCallRun | null> {
  const raw = await happyrobotFetch(`/api/v1/calls/${callId}`)
  if (raw === null) return null
  const parsed = HappyRobotCallRunSchema.parse(raw)
  return normalizeCallRun(parsed)
}
