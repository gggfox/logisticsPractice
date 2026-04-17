import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const metrics = await ctx.db.query('metrics').withIndex('by_timestamp').order('desc').collect()
    return metrics[0] ?? null
  },
})

export const getHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 24
    const metrics = await ctx.db.query('metrics').withIndex('by_timestamp').order('desc').collect()
    return metrics.slice(0, limit).reverse()
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
    const calls = await ctx.db.query('calls').collect()
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
