import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('loads').collect()
  },
})

export const getByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('loads')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .collect()
  },
})

export const getByLoadId = query({
  args: { load_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('loads')
      .withIndex('by_load_id', (q) => q.eq('load_id', args.load_id))
      .first()
  },
})

export const search = query({
  args: {
    origin: v.optional(v.string()),
    destination: v.optional(v.string()),
    equipment_type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db
      .query('loads')
      .withIndex('by_status', (q) => q.eq('status', 'available'))
      .collect()

    if (args.origin) {
      const originLower = args.origin.toLowerCase()
      results = results.filter((l) => l.origin.toLowerCase().includes(originLower))
    }
    if (args.destination) {
      const destLower = args.destination.toLowerCase()
      results = results.filter((l) => l.destination.toLowerCase().includes(destLower))
    }
    if (args.equipment_type) {
      results = results.filter((l) => l.equipment_type === args.equipment_type)
    }

    return results.sort(
      (a, b) => new Date(a.pickup_datetime).getTime() - new Date(b.pickup_datetime).getTime(),
    )
  },
})

export const upsert = mutation({
  args: {
    load_id: v.string(),
    origin: v.string(),
    destination: v.string(),
    pickup_datetime: v.string(),
    delivery_datetime: v.string(),
    equipment_type: v.string(),
    loadboard_rate: v.number(),
    notes: v.string(),
    weight: v.number(),
    commodity_type: v.string(),
    num_of_pieces: v.number(),
    miles: v.number(),
    dimensions: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('loads')
      .withIndex('by_load_id', (q) => q.eq('load_id', args.load_id))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert('loads', args)
  },
})

export const updateStatus = mutation({
  args: { load_id: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const load = await ctx.db
      .query('loads')
      .withIndex('by_load_id', (q) => q.eq('load_id', args.load_id))
      .first()
    if (!load) throw new Error(`Load ${args.load_id} not found`)
    await ctx.db.patch(load._id, { status: args.status })
  },
})
