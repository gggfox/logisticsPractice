import { z } from 'zod'
import { EQUIPMENT_TYPES, LOAD_STATUSES } from '../constants/index.js'

export const LoadSchema = z.object({
  load_id: z.string().min(1),
  origin: z.string().min(1),
  destination: z.string().min(1),
  pickup_datetime: z.string().datetime(),
  delivery_datetime: z.string().datetime(),
  equipment_type: z.enum(EQUIPMENT_TYPES),
  loadboard_rate: z.number().positive(),
  notes: z.string().default(''),
  weight: z.number().positive(),
  commodity_type: z.string().min(1),
  num_of_pieces: z.number().int().positive(),
  miles: z.number().positive(),
  dimensions: z.string().default(''),
  status: z.enum(LOAD_STATUSES).default('available'),
})

export type Load = z.infer<typeof LoadSchema>

export const LoadSearchParamsSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  equipment_type: z.enum(EQUIPMENT_TYPES).optional(),
  pickup_date: z.string().optional(),
})

export type LoadSearchParams = z.infer<typeof LoadSearchParamsSchema>

export const LoadResponseSchema = z.object({
  loads: z.array(LoadSchema),
  total: z.number().int().nonnegative(),
})

export type LoadResponse = z.infer<typeof LoadResponseSchema>
