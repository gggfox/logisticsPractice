import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('carriers').collect()
  },
})

export const getByMcNumber = query({
  args: { mc_number: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('carriers')
      .withIndex('by_mc_number', (q) => q.eq('mc_number', args.mc_number))
      .first()
  },
})

export const getEligible = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('carriers')
      .withIndex('by_eligible', (q) => q.eq('is_eligible', true))
      .collect()
  },
})

export const upsert = mutation({
  args: {
    mc_number: v.string(),
    legal_name: v.string(),
    dot_number: v.string(),
    operating_status: v.string(),
    safety_rating: v.optional(v.string()),
    is_eligible: v.boolean(),
    verified_at: v.string(),
    phone: v.optional(v.string()),
    total_drivers: v.optional(v.number()),
    total_power_units: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('carriers')
      .withIndex('by_mc_number', (q) => q.eq('mc_number', args.mc_number))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert('carriers', args)
  },
})
