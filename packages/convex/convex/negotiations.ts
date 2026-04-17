import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getByCallId = query({
  args: { call_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('negotiations')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .collect()
  },
})

export const getCurrentRound = query({
  args: { call_id: v.string() },
  handler: async (ctx, args) => {
    const rounds = await ctx.db
      .query('negotiations')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .collect()
    return rounds.length
  },
})

export const logRound = mutation({
  args: {
    call_id: v.string(),
    round: v.number(),
    offered_rate: v.number(),
    counter_rate: v.optional(v.number()),
    accepted: v.boolean(),
    timestamp: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('negotiations', args)
  },
})

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('negotiations').collect()
  },
})
