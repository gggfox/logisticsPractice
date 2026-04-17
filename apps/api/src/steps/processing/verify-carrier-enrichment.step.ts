import { type Handlers, type StepConfig, queue } from 'motia'
import { z } from 'zod'

export const config = {
  name: 'VerifyCarrierEnrichment',
  description: 'Background enrichment of carrier data after initial verification',
  triggers: [
    queue('carrier.verified', {
      input: z.object({
        mc_number: z.string(),
        legal_name: z.string(),
      }),
    }),
  ],
  flows: ['bridge-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async queue(data, { logger }) {
    logger.info('Enriching carrier data', {
      mc_number: data.mc_number,
      legal_name: data.legal_name,
    })
    // Future: fetch BASIC scores, authority history, insurance details from FMCSA
    // and write to Convex carrier record for the Carrier Intelligence dashboard
    logger.info('Carrier enrichment complete', { mc_number: data.mc_number })
  },
}
