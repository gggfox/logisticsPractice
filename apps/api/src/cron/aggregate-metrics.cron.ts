import { Cron } from 'croner'
import { logger } from '../logger.js'
import { withWideEvent } from '../observability/wide-event.js'
import { convexService } from '../services/convex.service.js'

type CallRecord = Awaited<ReturnType<typeof convexService.calls.getAll>>[number]

type SentimentDistribution = {
  positive: number
  neutral: number
  negative: number
  frustrated: number
}

type OutcomeDistribution = {
  booked: number
  declined: number
  no_match: number
  transferred: number
  dropped: number
}

async function computeAvgDiscountPercent(calls: CallRecord[]): Promise<number> {
  const loadsWithRates = calls.filter((c) => c.final_rate && c.load_id)
  if (loadsWithRates.length === 0) return 0

  const discounts = await Promise.all(
    loadsWithRates.map(async (c) => {
      const load = c.load_id ? await convexService.loads.getByLoadId(c.load_id) : null
      if (load && c.final_rate) {
        return ((load.loadboard_rate - c.final_rate) / load.loadboard_rate) * 100
      }
      return 0
    }),
  )
  return discounts.reduce((a, b) => a + b, 0) / discounts.length
}

function computeDistributions(calls: CallRecord[]): {
  sentimentDistribution: SentimentDistribution
  outcomeDistribution: OutcomeDistribution
} {
  const sentimentDistribution: SentimentDistribution = {
    positive: 0,
    neutral: 0,
    negative: 0,
    frustrated: 0,
  }
  const outcomeDistribution: OutcomeDistribution = {
    booked: 0,
    declined: 0,
    no_match: 0,
    transferred: 0,
    dropped: 0,
  }

  for (const call of calls) {
    if (call.sentiment && call.sentiment in sentimentDistribution) {
      sentimentDistribution[call.sentiment as keyof SentimentDistribution]++
    }
    if (call.outcome && call.outcome in outcomeDistribution) {
      outcomeDistribution[call.outcome as keyof OutcomeDistribution]++
    }
  }

  return { sentimentDistribution, outcomeDistribution }
}

async function computeTopLanes(
  calls: CallRecord[],
): Promise<{ origin: string; destination: string; count: number }[]> {
  const laneCounts = new Map<string, { origin: string; destination: string; count: number }>()
  for (const call of calls) {
    if (!call.load_id) continue
    const load = await convexService.loads.getByLoadId(call.load_id)
    if (!load) continue

    const key = `${load.origin}|${load.destination}`
    const existing = laneCounts.get(key)
    if (existing) {
      existing.count++
    } else {
      laneCounts.set(key, { origin: load.origin, destination: load.destination, count: 1 })
    }
  }

  return Array.from(laneCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

async function runAggregation(): Promise<void> {
  await withWideEvent(
    'AggregateMetrics',
    { logger, seed: { trigger_type: 'cron', trigger_topic: '0 * * * *' } },
    async (enrich) => {
      const calls: CallRecord[] = await convexService.calls.getAll()

      const totalCalls = calls.length
      const bookedCalls = calls.filter((c) => c.outcome === 'booked')
      const bookingRate = totalCalls > 0 ? bookedCalls.length / totalCalls : 0
      const avgNegotiationRounds =
        totalCalls > 0 ? calls.reduce((sum, c) => sum + c.negotiation_rounds, 0) / totalCalls : 0

      const avgDiscountPercent = await computeAvgDiscountPercent(calls)
      const { sentimentDistribution, outcomeDistribution } = computeDistributions(calls)
      const topLanes = await computeTopLanes(calls)
      const revenueBooked = bookedCalls.reduce((sum, c) => sum + (c.final_rate ?? 0), 0)

      await convexService.metrics.write({
        timestamp: new Date().toISOString(),
        total_calls: totalCalls,
        booking_rate: bookingRate,
        avg_negotiation_rounds: avgNegotiationRounds,
        avg_discount_percent: avgDiscountPercent,
        sentiment_distribution: sentimentDistribution,
        outcome_distribution: outcomeDistribution,
        top_lanes: topLanes,
        revenue_booked: revenueBooked,
      })

      const [topLane] = topLanes
      enrich({
        total_calls: totalCalls,
        booked_calls: bookedCalls.length,
        booking_rate: bookingRate,
        avg_negotiation_rounds: avgNegotiationRounds,
        avg_discount_percent: avgDiscountPercent,
        revenue_booked: revenueBooked,
        top_lane_origin: topLane?.origin,
        top_lane_destination: topLane?.destination,
        top_lane_count: topLane?.count,
      })
    },
  )
}

let job: Cron | null = null

export function startAggregateMetricsCron(): void {
  if (job) return
  // Hourly on the hour, single concurrent run, swallow errors so the
  // scheduler keeps ticking.
  job = new Cron('0 * * * *', { protect: true }, () => {
    runAggregation().catch((err) => {
      logger.error({ err }, 'aggregate-metrics cron tick failed')
    })
  })
  logger.info({ pattern: '0 * * * *' }, 'aggregate-metrics cron scheduled')
}

export function stopAggregateMetricsCron(): void {
  job?.stop()
  job = null
}
