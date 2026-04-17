import type { Worker } from 'bullmq'
import { logger } from '../logger.js'
import { createAnalyzeSentimentWorker } from './analyze-sentiment.worker.js'
import { createClassifyCallWorker } from './classify-call.worker.js'
import { createVerifyCarrierEnrichmentWorker } from './verify-carrier-enrichment.worker.js'

let workers: Worker[] = []

export function startWorkers(): void {
  if (workers.length > 0) return
  workers = [
    createClassifyCallWorker(),
    createAnalyzeSentimentWorker(),
    createVerifyCarrierEnrichmentWorker(),
  ]
  logger.info({ count: workers.length }, 'BullMQ workers started')
}

export async function stopWorkers(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()))
  workers = []
}
