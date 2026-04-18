import { z } from 'zod'

export const CarrierSchema = z.object({
  mc_number: z.string().min(1),
  legal_name: z.string().min(1),
  dot_number: z.string().min(1),
  operating_status: z.string(),
  safety_rating: z.string().optional(),
  is_eligible: z.boolean(),
  verified_at: z.string().datetime(),
  phone: z.string().optional(),
  total_drivers: z.number().int().nonnegative().optional(),
  total_power_units: z.number().int().nonnegative().optional(),
})

export type Carrier = z.infer<typeof CarrierSchema>

export const CarrierVerificationResponseSchema = z.object({
  mc_number: z.string(),
  legal_name: z.string(),
  is_eligible: z.boolean(),
  operating_status: z.string(),
  reason: z.string().optional(),
})

export type CarrierVerificationResponse = z.infer<typeof CarrierVerificationResponseSchema>

// FMCSA's live API is inconsistent about types: numeric IDs arrive as
// `number` for large carriers and `string` for smaller ones; optional string
// fields come back as `null` (not absent) when unrated/unknown. Model both
// shapes here so consumers get clean `string | undefined` after parsing.
const fmcsaNullishString = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined)

const fmcsaNullishNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? undefined)

export const FMCSACarrierResponseSchema = z.object({
  content: z.object({
    carrier: z.object({
      legalName: z.string(),
      dotNumber: z.union([z.string(), z.number()]).transform(String),
      mcNumber: fmcsaNullishString,
      allowedToOperate: z.string(),
      bipdInsuranceOnFile: fmcsaNullishString,
      bipdInsuranceRequired: fmcsaNullishString,
      bondInsuranceOnFile: fmcsaNullishString,
      safetyRating: fmcsaNullishString,
      totalDrivers: fmcsaNullishNumber,
      totalPowerUnits: fmcsaNullishNumber,
      phone: fmcsaNullishString,
      statusCode: z.string(),
      oosDate: fmcsaNullishString,
    }),
  }),
})

export type FMCSACarrierResponse = z.infer<typeof FMCSACarrierResponseSchema>
