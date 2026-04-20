import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50
    const calls = await ctx.db.query('calls').withIndex('by_started_at').order('desc').collect()
    return calls.slice(0, limit)
  },
})

export const getByCallId = query({
  args: { call_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .first()
  },
})

export const getByOutcome = query({
  args: { outcome: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('calls')
      .withIndex('by_outcome', (q) => q.eq('outcome', args.outcome))
      .collect()
  },
})

export const getByCarrier = query({
  args: { carrier_mc: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('calls')
      .withIndex('by_carrier', (q) => q.eq('carrier_mc', args.carrier_mc))
      .collect()
  },
})

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('calls').withIndex('by_started_at').order('desc').collect()
  },
})

export const create = mutation({
  args: {
    call_id: v.string(),
    carrier_mc: v.string(),
    load_id: v.optional(v.string()),
    transcript: v.string(),
    speakers: v.optional(v.array(v.object({ role: v.string(), text: v.string() }))),
    outcome: v.optional(v.string()),
    sentiment: v.optional(v.string()),
    duration_seconds: v.optional(v.number()),
    negotiation_rounds: v.number(),
    final_rate: v.optional(v.number()),
    started_at: v.string(),
    ended_at: v.optional(v.string()),
  },
  // Upsert by `call_id`: HappyRobot re-delivers webhooks and the two
  // workers (classify + sentiment) race on the same row. Patch on hit
  // preserves any sentiment already written; insert on miss creates it.
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert('calls', args)
  },
})

export const updateOutcome = mutation({
  args: {
    call_id: v.string(),
    outcome: v.string(),
    sentiment: v.optional(v.string()),
    final_rate: v.optional(v.number()),
    negotiation_rounds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .first()
    if (!call) throw new Error(`Call ${args.call_id} not found`)

    const patch: Record<string, unknown> = { outcome: args.outcome }
    if (args.sentiment !== undefined) patch.sentiment = args.sentiment
    if (args.final_rate !== undefined) patch.final_rate = args.final_rate
    if (args.negotiation_rounds !== undefined) patch.negotiation_rounds = args.negotiation_rounds

    await ctx.db.patch(call._id, patch)
  },
})

// Purpose-built patch so the sentiment worker never clobbers the
// classify worker's `outcome`. The worker race was the root cause of
// every recent call showing `declined`.
export const updateSentiment = mutation({
  args: {
    call_id: v.string(),
    sentiment: v.string(),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .first()
    // The sentiment worker can land before the classify worker has
    // created the row. Upsert a minimal record so sentiment is not lost.
    if (!call) {
      await ctx.db.insert('calls', {
        call_id: args.call_id,
        carrier_mc: 'unknown',
        transcript: '',
        sentiment: args.sentiment,
        negotiation_rounds: 0,
        started_at: new Date().toISOString(),
      })
      return
    }
    await ctx.db.patch(call._id, { sentiment: args.sentiment })
  },
})
