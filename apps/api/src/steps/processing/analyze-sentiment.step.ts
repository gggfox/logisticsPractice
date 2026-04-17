import type { Sentiment } from '@carrier-sales/shared'
import { type Handlers, type StepConfig, queue } from 'motia'
import { z } from 'zod'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'AnalyzeSentiment',
  description: 'Analyze carrier sentiment from call transcript',
  triggers: [
    queue('call.completed', {
      input: z.object({
        call_id: z.string(),
        transcript: z.string().optional(),
      }),
    }),
  ],
  flows: ['webhook-processing'],
} as const satisfies StepConfig

const SENTIMENT_SIGNALS: Record<Sentiment, string[]> = {
  positive: [
    'sounds good',
    'sounds great',
    "let's do it",
    'perfect',
    'deal',
    'i accept',
    'we can do that',
    'happy to',
    'appreciate',
    'thanks',
    'excellent',
    'works for me',
  ],
  negative: [
    'not interested',
    'too low',
    'no thanks',
    'pass on',
    "can't do",
    'way too',
    'not worth',
    'below market',
    'lowball',
  ],
  frustrated: [
    'ridiculous',
    'waste of time',
    'insane',
    'you kidding',
    'joke',
    'terrible',
    'worst',
    'absurd',
    'never',
    'unacceptable',
    'come on',
  ],
  neutral: [],
}

function analyzeSentiment(transcript: string): { sentiment: Sentiment; confidence: number } {
  const lower = transcript.toLowerCase()
  const scores: Record<Sentiment, number> = { positive: 0, negative: 0, frustrated: 0, neutral: 0 }

  for (const [sentiment, signals] of Object.entries(SENTIMENT_SIGNALS)) {
    for (const signal of signals) {
      if (lower.includes(signal)) {
        scores[sentiment as Sentiment] += 1
      }
    }
  }

  const totalSignals = Object.values(scores).reduce((a, b) => a + b, 0)

  if (totalSignals === 0) {
    return { sentiment: 'neutral', confidence: 0.5 }
  }

  const entries = Object.entries(scores) as [Sentiment, number][]
  entries.sort((a, b) => b[1] - a[1])

  const [topSentiment, topScore] = entries[0] ?? (['neutral', 0] as [Sentiment, number])

  return {
    sentiment: topSentiment,
    confidence: Math.min(0.95, topScore / totalSignals),
  }
}

export const handler: Handlers<typeof config> = {
  async queue(data, { logger }) {
    if (!data.transcript) {
      logger.info('No transcript for sentiment analysis', { call_id: data.call_id })
      return
    }

    logger.info('Analyzing sentiment', { call_id: data.call_id })

    const { sentiment, confidence } = analyzeSentiment(data.transcript)

    await convexService.calls.updateOutcome({
      call_id: data.call_id,
      outcome: 'declined', // will be overridden by classify-call if needed
      sentiment,
    })

    logger.info('Sentiment analyzed', { call_id: data.call_id, sentiment, confidence })
  },
}
