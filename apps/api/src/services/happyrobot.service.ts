import { config } from '../config.js'

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
