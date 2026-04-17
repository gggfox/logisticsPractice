import { Worker } from 'bullmq'
import { logger } from '../logger.js'
import { withWideEvent } from '../observability/wide-event.js'
import {
  QUEUE_NAMES,
  type VerifyCarrierEnrichmentInput,
  VerifyCarrierEnrichmentInputSchema,
  getRedisConnection,
} from '../queues/index.js'

export function createVerifyCarrierEnrichmentWorker(): Worker<VerifyCarrierEnrichmentInput> {
  const worker = new Worker<VerifyCarrierEnrichmentInput>(
    QUEUE_NAMES.verifyCarrier,
    async (job) => {
      const data = VerifyCarrierEnrichmentInputSchema.parse(job.data)

      await withWideEvent(
        'VerifyCarrierEnrichment',
        { logger, seed: { trigger_type: 'queue', trigger_topic: QUEUE_NAMES.verifyCarrier } },
        async (enrich) => {
          enrich({ mc_number: data.mc_number, legal_name: data.legal_name })
          // Future: fetch BASIC scores, authority history, insurance details
          // from FMCSA and write to Convex for the Carrier Intelligence view.
          enrich({ enrichment_source: 'none', fields_enriched: 0 })
        },
      )
    },
    { connection: getRedisConnection() },
  )

  worker.on('failed', (job, err) => {
    logger.error(
      { job_id: job?.id, queue: QUEUE_NAMES.verifyCarrier, err },
      'verify-carrier-enrichment worker job failed',
    )
  })

  return worker
}
