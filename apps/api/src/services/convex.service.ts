import { api } from '@carrier-sales/convex/convex/_generated/api'
import { ConvexHttpClient } from 'convex/browser'
import { config } from '../config.js'

let client: ConvexHttpClient | null = null

function getClient(): ConvexHttpClient {
  client ??= new ConvexHttpClient(config.convex.url)
  return client
}

export const convexService = {
  loads: {
    search: (params: { origin?: string; destination?: string; equipment_type?: string }) =>
      getClient().query(api.loads.search, params),

    getByLoadId: (load_id: string) => getClient().query(api.loads.getByLoadId, { load_id }),

    getAll: () => getClient().query(api.loads.getAll, {}),

    getByStatus: (status: string) => getClient().query(api.loads.getByStatus, { status }),

    upsert: (load: {
      load_id: string
      origin: string
      destination: string
      pickup_datetime: string
      delivery_datetime: string
      equipment_type: string
      loadboard_rate: number
      notes: string
      weight: number
      commodity_type: string
      num_of_pieces: number
      miles: number
      dimensions: string
      status: string
    }) => getClient().mutation(api.loads.upsert, load),

    updateStatus: (load_id: string, status: string) =>
      getClient().mutation(api.loads.updateStatus, { load_id, status }),
  },

  carriers: {
    getByMcNumber: (mc_number: string) =>
      getClient().query(api.carriers.getByMcNumber, { mc_number }),

    getAll: () => getClient().query(api.carriers.getAll, {}),

    upsert: (carrier: {
      mc_number: string
      legal_name: string
      dot_number: string
      operating_status: string
      safety_rating?: string
      is_eligible: boolean
      verified_at: string
      phone?: string
      total_drivers?: number
      total_power_units?: number
    }) => getClient().mutation(api.carriers.upsert, carrier),
  },

  calls: {
    getRecent: (limit?: number) => getClient().query(api.calls.getRecent, { limit }),

    getByCallId: (call_id: string) => getClient().query(api.calls.getByCallId, { call_id }),

    getAll: () => getClient().query(api.calls.getAll, {}),

    create: (call: {
      call_id: string
      carrier_mc: string
      load_id?: string
      transcript: string
      outcome?: string
      sentiment?: string
      duration_seconds?: number
      negotiation_rounds: number
      final_rate?: number
      started_at: string
      ended_at?: string
    }) => getClient().mutation(api.calls.create, call),

    updateOutcome: (params: {
      call_id: string
      outcome: string
      sentiment?: string
      final_rate?: number
      negotiation_rounds?: number
    }) => getClient().mutation(api.calls.updateOutcome, params),
  },

  negotiations: {
    getByCallId: (call_id: string) => getClient().query(api.negotiations.getByCallId, { call_id }),

    getCurrentRound: (call_id: string) =>
      getClient().query(api.negotiations.getCurrentRound, { call_id }),

    logRound: (round: {
      call_id: string
      round: number
      offered_rate: number
      counter_rate?: number
      accepted: boolean
      timestamp: string
    }) => getClient().mutation(api.negotiations.logRound, round),
  },

  metrics: {
    getLatest: () => getClient().query(api.metrics.getLatest, {}),
    getHistory: (limit?: number) => getClient().query(api.metrics.getHistory, { limit }),
    getSummary: () => getClient().query(api.metrics.getSummary, {}),
    write: (data: {
      timestamp: string
      total_calls: number
      booking_rate: number
      avg_negotiation_rounds: number
      avg_discount_percent: number
      sentiment_distribution: {
        positive: number
        neutral: number
        negative: number
        frustrated: number
      }
      outcome_distribution: {
        booked: number
        declined: number
        no_match: number
        transferred: number
        dropped: number
      }
      top_lanes: Array<{ origin: string; destination: string; count: number }>
      revenue_booked: number
    }) => getClient().mutation(api.metrics.write, data),
  },
}
