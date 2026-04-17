import { z } from 'zod'
import { CALL_OUTCOMES, SENTIMENTS } from '../constants/index.js'

export const CallSchema = z.object({
  call_id: z.string().min(1),
  carrier_mc: z.string().min(1),
  load_id: z.string().optional(),
  transcript: z.string().default(''),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  sentiment: z.enum(SENTIMENTS).optional(),
  duration_seconds: z.number().nonnegative().optional(),
  negotiation_rounds: z.number().int().nonnegative().default(0),
  final_rate: z.number().positive().optional(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
})

export type Call = z.infer<typeof CallSchema>

export const CallWebhookPayloadSchema = z.object({
  call_id: z.string(),
  phone_number: z.string().optional(),
  carrier_mc: z.string().optional(),
  load_id: z.string().optional(),
  transcript: z.string().optional(),
  duration_seconds: z.number().optional(),
  started_at: z.string(),
  ended_at: z.string(),
  status: z.string(),
  extracted_data: z.record(z.unknown()).optional(),
})

export type CallWebhookPayload = z.infer<typeof CallWebhookPayloadSchema>

export const CallClassificationSchema = z.object({
  call_id: z.string(),
  outcome: z.enum(CALL_OUTCOMES),
  sentiment: z.enum(SENTIMENTS),
  confidence: z.number().min(0).max(1),
})

export type CallClassification = z.infer<typeof CallClassificationSchema>
