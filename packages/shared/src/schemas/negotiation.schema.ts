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
  call_id: z.coerce.string().min(1),
  load_id: z.coerce.string().min(1),
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
