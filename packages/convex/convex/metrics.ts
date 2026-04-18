import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

// Hard cap for reads reachable anonymously via the deployment URL. Prevents
// `getSummary` from scanning the whole `calls` table as it grows; also keeps
// paginated history queries bounded.
const MAX_ROWS = 1000
const SUMMARY_SAMPLE = 5000

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const [latest] = await ctx.db.query('metrics').withIndex('by_timestamp').order('desc').take(1)
    return latest ?? null
  },
})

export const getHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const requested = args.limit ?? 24
    const limit = Math.min(requested, MAX_ROWS)
    const metrics = await ctx.db
      .query('metrics')
      .withIndex('by_timestamp')
      .order('desc')
      .take(limit)
    return metrics.reverse()
  },
})

export const write = mutation({
  args: {
    timestamp: v.string(),
    total_calls: v.number(),
    booking_rate: v.number(),
    avg_negotiation_rounds: v.number(),
    avg_discount_percent: v.number(),
    sentiment_distribution: v.object({
      positive: v.number(),
      neutral: v.number(),
      negative: v.number(),
      frustrated: v.number(),
    }),
    outcome_distribution: v.object({
      booked: v.number(),
      declined: v.number(),
      no_match: v.number(),
      transferred: v.number(),
      dropped: v.number(),
    }),
    top_lanes: v.array(
      v.object({
        origin: v.string(),
        destination: v.string(),
        count: v.number(),
      }),
    ),
    revenue_booked: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('metrics', args)
  },
})

export const getSummary = query({
  args: {},
  handler: async (ctx) => {
    // Bounded sample: a dashboard summary does not need the full call history
    // and this query is reachable anonymously via the Convex deployment URL.
    // The aggregate cron writes point-in-time snapshots to the `metrics` table
    // for accurate long-term values.
    const calls = await ctx.db.query('calls').take(SUMMARY_SAMPLE)
    const totalCalls = calls.length
    const bookedCalls = calls.filter((c) => c.outcome === 'booked').length
    const bookingRate = totalCalls > 0 ? bookedCalls / totalCalls : 0
    const revenueBooked = calls
      .filter((c) => c.outcome === 'booked' && c.final_rate)
      .reduce((sum, c) => sum + (c.final_rate ?? 0), 0)

    const avgNegRounds =
      totalCalls > 0 ? calls.reduce((sum, c) => sum + c.negotiation_rounds, 0) / totalCalls : 0

    const sentimentDist = { positive: 0, neutral: 0, negative: 0, frustrated: 0 }
    const outcomeDist = { booked: 0, declined: 0, no_match: 0, transferred: 0, dropped: 0 }

    for (const call of calls) {
      if (call.sentiment && call.sentiment in sentimentDist) {
        sentimentDist[call.sentiment as keyof typeof sentimentDist]++
      }
      if (call.outcome && call.outcome in outcomeDist) {
        outcomeDist[call.outcome as keyof typeof outcomeDist]++
      }
    }

    return {
      total_calls: totalCalls,
      booking_rate: bookingRate,
      revenue_booked: revenueBooked,
      avg_negotiation_rounds: avgNegRounds,
      sentiment_distribution: sentimentDist,
      outcome_distribution: outcomeDist,
    }
  },
})
