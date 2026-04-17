import { type Handlers, type StepConfig, queue } from 'motia'
import { z } from 'zod'
import { withWideEvent } from '../../observability/wide-event.js'

const InputSchema = z.object({
  mc_number: z.string(),
  legal_name: z.string(),
})
type Input = z.infer<typeof InputSchema>

export const config = {
  name: 'VerifyCarrierEnrichment',
  description: 'Background enrichment of carrier data after initial verification',
  triggers: [
    queue('carrier.verified', {
      input: InputSchema,
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (input, ctx) =>
  withWideEvent('VerifyCarrierEnrichment', ctx, async (enrich) => {
    const data = input as Input
    enrich({ mc_number: data.mc_number, legal_name: data.legal_name })
    // Future: fetch BASIC scores, authority history, insurance details from FMCSA
    // and write to Convex carrier record for the Carrier Intelligence dashboard.
    enrich({ enrichment_source: 'none', fields_enriched: 0 })
  })
