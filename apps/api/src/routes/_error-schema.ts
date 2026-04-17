import { z } from 'zod'

export const ErrorBodySchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
})

export type ErrorBody = z.infer<typeof ErrorBodySchema>
