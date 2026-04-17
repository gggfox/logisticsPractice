const getBaseUrl = () => process.env.HAPPYROBOT_BASE_URL ?? 'https://api.happyrobot.ai'
const getApiKey = () => {
  const key = process.env.HAPPYROBOT_API_KEY
  if (!key) throw new Error('HAPPYROBOT_API_KEY environment variable is required')
  return key
}

async function happyrobotFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
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
  const data = await happyrobotFetch(`/api/v1/calls/${callId}/transcript`)

  return {
    transcript: data.transcript ?? '',
    speakers: data.speakers ?? [],
  }
}

export async function getCallDetails(callId: string) {
  return happyrobotFetch(`/api/v1/calls/${callId}`)
}
