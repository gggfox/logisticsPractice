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
    run_id: v.optional(v.string()),
    hr_run_fetched: v.optional(v.boolean()),
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

// Partial upsert from the `/api/v1/offers` bridge. HappyRobot's
// `session.status_changed` webhook does NOT carry transcript, carrier,
// load, or extraction data -- only session lifecycle. The offer route
// IS the authoritative source for those fields during an active call,
// and it fires before the `completed` webhook. Write a row early so
// the dashboard shows carrier/load/rate/rounds immediately, and never
// regress fields the classify or sentiment worker has already set.
export const upsertFromOffer = mutation({
  args: {
    call_id: v.string(),
    carrier_mc: v.optional(v.string()),
    load_id: v.optional(v.string()),
    negotiation_rounds: v.optional(v.number()),
    final_rate: v.optional(v.number()),
    outcome: v.optional(v.string()),
    started_at: v.optional(v.string()),
    ended_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .first()

    if (!existing) {
      await ctx.db.insert('calls', {
        call_id: args.call_id,
        carrier_mc: args.carrier_mc ?? 'unknown',
        load_id: args.load_id,
        transcript: '',
        negotiation_rounds: args.negotiation_rounds ?? 0,
        final_rate: args.final_rate,
        outcome: args.outcome,
        started_at: args.started_at ?? new Date().toISOString(),
        ended_at: args.ended_at,
      })
      return
    }

    const patch: Record<string, unknown> = {}
    // Only upgrade `carrier_mc` -- never overwrite a concrete MC with
    // `'unknown'` from a later unrelated offer row.
    if (args.carrier_mc !== undefined && args.carrier_mc !== 'unknown') {
      patch.carrier_mc = args.carrier_mc
    }
    if (args.load_id !== undefined) patch.load_id = args.load_id
    if (args.negotiation_rounds !== undefined) {
      // Take the max so late-arriving round 1 can't rewrite round 3.
      patch.negotiation_rounds = Math.max(existing.negotiation_rounds ?? 0, args.negotiation_rounds)
    }
    if (args.final_rate !== undefined) patch.final_rate = args.final_rate
    // Do not overwrite a concrete outcome (e.g. `booked`) with a
    // transient one from a mid-negotiation offer.
    if (args.outcome !== undefined && existing.outcome === undefined) {
      patch.outcome = args.outcome
    }
    if (args.started_at !== undefined && existing.started_at === undefined) {
      patch.started_at = args.started_at
    }
    if (args.ended_at !== undefined) patch.ended_at = args.ended_at

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(existing._id, patch)
    }
  },
})

// One-shot cleanup for `call_id: 'unknown'` rows. The route now skips
// webhooks without a correlation id, but this keeps the safety valve in
// place: running it is always safe, idempotent, and returns the deleted
// count so dashboard users can verify. Intended to be invoked via the
// Convex "Run function" panel; no external caller wires it up.
export const deleteOrphans = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', 'unknown'))
      .collect()
    for (const r of rows) await ctx.db.delete(r._id)
    return rows.length
  },
})

// Authoritative "deal closed" write. Called by `POST
// /api/v1/loads/:load_id/book` after the caller accepts a final rate.
// Unlike `upsertFromOffer` -- which deliberately never overwrites a
// concrete outcome mid-negotiation -- this mutation **always** forces
// `outcome: 'booked'`, `carrier_mc`, `load_id`, and `final_rate`. It is
// the only endpoint that can promote an earlier classify-written
// `dropped` / `declined` row to `booked`, so the call-history row and
// the load-board stay consistent with what actually happened on the
// call.
export const markBooked = mutation({
  args: {
    call_id: v.string(),
    load_id: v.string(),
    carrier_mc: v.string(),
    final_rate: v.number(),
    started_at: v.optional(v.string()),
    ended_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('calls')
      .withIndex('by_call_id', (q) => q.eq('call_id', args.call_id))
      .first()

    if (!existing) {
      await ctx.db.insert('calls', {
        call_id: args.call_id,
        carrier_mc: args.carrier_mc,
        load_id: args.load_id,
        transcript: '',
        outcome: 'booked',
        final_rate: args.final_rate,
        // Seed at least one round so the UI doesn't show "0 rounds" on
        // a successful booking -- the log-offer route may not have fired.
        negotiation_rounds: 1,
        started_at: args.started_at ?? new Date().toISOString(),
        ended_at: args.ended_at,
      })
      return
    }

    const patch: Record<string, unknown> = {
      carrier_mc: args.carrier_mc,
      load_id: args.load_id,
      final_rate: args.final_rate,
      outcome: 'booked',
    }
    // Preserve whatever negotiation_rounds the log-offer route already
    // recorded; only floor it at 1 so a booked row never reads as 0 rounds.
    if ((existing.negotiation_rounds ?? 0) < 1) {
      patch.negotiation_rounds = 1
    }
    if (args.ended_at !== undefined) patch.ended_at = args.ended_at

    await ctx.db.patch(existing._id, patch)
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
