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

export const FMCSACarrierResponseSchema = z.object({
  content: z.object({
    carrier: z.object({
      legalName: z.string(),
      dotNumber: z.string(),
      mcNumber: z.string().optional(),
      allowedToOperate: z.string(),
      bipdInsuranceOnFile: z.string().optional(),
      bipdInsuranceRequired: z.string().optional(),
      bondInsuranceOnFile: z.string().optional(),
      safetyRating: z.string().optional(),
      totalDrivers: z.number().optional(),
      totalPowerUnits: z.number().optional(),
      phone: z.string().optional(),
      statusCode: z.string(),
      oosDate: z.string().optional(),
    }),
  }),
})

export type FMCSACarrierResponse = z.infer<typeof FMCSACarrierResponseSchema>
