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

// Intentionally permissive: HappyRobot's native workflow-completed webhook
// body does NOT let the user template every field, so the real payload we
// receive at `/api/v1/webhooks/call-completed` mixes our documented shape
// with HappyRobot's built-in envelope (`run_id`, `session_id`, `variables`,
// `classification`, `extraction`, ...). Rejecting unknown fields at the
// schema layer just turned every live call into a 400. The route is
// responsible for normalizing into the canonical shape below.
export const CallWebhookPayloadSchema = z
  .object({
    // Any of these may carry the call identifier depending on the sender.
    call_id: z.string().optional(),
    run_id: z.string().optional(),
    session_id: z.string().optional(),

    phone_number: z.string().optional(),
    carrier_mc: z.string().optional(),
    load_id: z.string().optional(),
    transcript: z.string().optional(),
    duration_seconds: z.number().optional(),

    // Timestamps may be absent on the HappyRobot envelope -- the route
    // defaults to "now" when missing so Convex's required `started_at`
    // is still satisfied.
    started_at: z.string().optional(),
    ended_at: z.string().optional(),

    status: z.string().optional(),
    extracted_data: z.record(z.unknown()).optional(),

    // HappyRobot native envelope fields.
    variables: z.record(z.unknown()).optional(),
    classification: z.record(z.unknown()).optional(),
    extraction: z.record(z.unknown()).optional(),
  })
  .passthrough()

export type CallWebhookPayload = z.infer<typeof CallWebhookPayloadSchema>

export const CallClassificationSchema = z.object({
  call_id: z.string(),
  outcome: z.enum(CALL_OUTCOMES),
  sentiment: z.enum(SENTIMENTS),
  confidence: z.number().min(0).max(1),
})

export type CallClassification = z.infer<typeof CallClassificationSchema>
