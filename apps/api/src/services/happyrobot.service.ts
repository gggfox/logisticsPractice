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

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`HappyRobot API error ${response.status}: ${response.statusText}`)
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
