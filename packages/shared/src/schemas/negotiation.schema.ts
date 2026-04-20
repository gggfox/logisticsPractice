import { z } from 'zod'
import { MAX_NEGOTIATION_ROUNDS } from '../constants/index.js'

export const NegotiationRoundSchema = z.object({
  call_id: z.string().min(1),
  round: z.number().int().min(1).max(MAX_NEGOTIATION_ROUNDS),
  offered_rate: z.number().positive(),
  counter_rate: z.number().positive().optional(),
  accepted: z.boolean(),
  timestamp: z.string().datetime(),
})

export type NegotiationRound = z.infer<typeof NegotiationRoundSchema>

export const OfferRequestSchema = z.object({
  // `call_id` and `load_id` are string-typed in every HR payload we've
  // seen; do NOT wrap them in `z.coerce.string()` because `String(undefined)`
  // is the literal `"undefined"`, which passes `.min(1)` and silently
  // forwards missing values to the server. `carrier_mc` stays coerced
  // because HR's `negotiate_offer` webhook sends it as an unquoted
  // JSON number (e.g. `"carrier_mc": 264184`).
  call_id: z.string().min(1),
  load_id: z.string().min(1),
  carrier_mc: z.coerce.string().min(1),
  offered_rate: z.coerce.number().positive(),
})

export type OfferRequest = z.infer<typeof OfferRequestSchema>

export const OfferResponseSchema = z.object({
  accepted: z.boolean(),
  counter_offer: z.number().positive().optional(),
  round: z.number().int().min(1).max(MAX_NEGOTIATION_ROUNDS),
  max_rounds_reached: z.boolean(),
  message: z.string(),
})

export type OfferResponse = z.infer<typeof OfferResponseSchema>

// Booking confirmation. Used by the `book_load` HR tool (or a downstream
// sales system after `transfer_to_sales`) once the caller accepts a
// rate. `carrier_mc` is required because this endpoint is the
// authoritative "the deal closed" event -- if it's missing here, the
// `calls` row can end up with `carrier_mc: 'unknown'` even though the
// load just got flipped to `booked`, which is exactly the data-loss
// mode we are trying to close.
//
// We can't use plain `z.coerce.string()` on `carrier_mc`: `String(undefined)`
// is the literal `"undefined"` and would pass `.min(1)`, silently accepting
// bookings with no carrier. The union-then-pipe guarantees the caller
// actually sent a value (HappyRobot's `negotiate_offer` webhook ships
// carrier_mc as an unquoted JSON number, so both shapes must be accepted).
export const BookLoadRequestSchema = z.object({
  agreed_rate: z.coerce.number().positive(),
  carrier_mc: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .pipe(z.string().min(1)),
})

export type BookLoadRequest = z.infer<typeof BookLoadRequestSchema>

export const BookLoadResponseSchema = z.object({
  booked: z.boolean(),
  load_id: z.string().min(1),
  call_id: z.string().min(1),
  agreed_rate: z.number().positive(),
  loadboard_rate: z.number().positive(),
  message: z.string(),
})

export type BookLoadResponse = z.infer<typeof BookLoadResponseSchema>
