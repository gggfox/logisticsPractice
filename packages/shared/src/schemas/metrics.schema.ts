import { z } from 'zod'

export const MetricsSnapshotSchema = z.object({
  timestamp: z.string().datetime(),
  total_calls: z.number().int().nonnegative(),
  booking_rate: z.number().min(0).max(1),
  avg_negotiation_rounds: z.number().nonnegative(),
  avg_discount_percent: z.number(),
  sentiment_distribution: z.object({
    positive: z.number().int().nonnegative(),
    neutral: z.number().int().nonnegative(),
    negative: z.number().int().nonnegative(),
    frustrated: z.number().int().nonnegative(),
  }),
  outcome_distribution: z.object({
    booked: z.number().int().nonnegative(),
    declined: z.number().int().nonnegative(),
    no_match: z.number().int().nonnegative(),
    transferred: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
  }),
  top_lanes: z.array(
    z.object({
      origin: z.string(),
      destination: z.string(),
      count: z.number().int().positive(),
    }),
  ),
  revenue_booked: z.number().nonnegative(),
})

export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>
