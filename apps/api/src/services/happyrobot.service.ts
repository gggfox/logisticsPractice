import { config } from '../config.js'

async function happyrobotFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${config.happyrobot.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.happyrobot.apiKey}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(`HappyRobot API error ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

export async function getCallTranscript(
  callId: string,
): Promise<{ transcript: string; speakers: Array<{ role: string; text: string }> }> {
  const data = (await happyrobotFetch(`/api/v1/calls/${callId}/transcript`)) as {
    transcript?: string
    speakers?: Array<{ role: string; text: string }>
  }

  return {
    transcript: data.transcript ?? '',
    speakers: data.speakers ?? [],
  }
}

export async function getCallDetails(callId: string) {
  return happyrobotFetch(`/api/v1/calls/${callId}`)
}
