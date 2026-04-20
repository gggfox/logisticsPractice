import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  loads: defineTable({
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
  })
    .index('by_load_id', ['load_id'])
    .index('by_status', ['status'])
    .index('by_equipment', ['equipment_type'])
    .index('by_origin', ['origin']),

  carriers: defineTable({
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
  })
    .index('by_mc_number', ['mc_number'])
    .index('by_eligible', ['is_eligible']),

  calls: defineTable({
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
  })
    .index('by_call_id', ['call_id'])
    .index('by_started_at', ['started_at'])
    .index('by_outcome', ['outcome'])
    .index('by_carrier', ['carrier_mc']),

  negotiations: defineTable({
    call_id: v.string(),
    round: v.number(),
    offered_rate: v.number(),
    counter_rate: v.optional(v.number()),
    accepted: v.boolean(),
    timestamp: v.string(),
  })
    .index('by_call_id', ['call_id'])
    .index('by_call_round', ['call_id', 'round']),

  metrics: defineTable({
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
  }).index('by_timestamp', ['timestamp']),
})
